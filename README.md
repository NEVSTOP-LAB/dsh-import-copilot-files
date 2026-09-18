# dsh-import-vscode-ai-files

在 [DeepSeek Harness](https://github.com/deepseek-ai) 会话中加载 **VSCode / Copilot 风格**的 AI 配置，
让同一份仓库配置在 VSCode 和 DSH 里都生效。

- DSH 组合行 id：`import-vscode-ai-files`
- 平面：**host**（`~/.dsh/profiles/<profile>/cordis.patch.yml`）
- 安装：`pwsh -File install.ps1` → **重启 DSH**（见下）

## 支持的文件

| 文件 | 行为 |
|---|---|
| `.github/copilot-instructions.md` | 常驻注入（等价 VSCode 的 repo-wide instructions） |
| `.github/instructions/**/*.instructions.md` | 解析 frontmatter `applyTo`；无 `applyTo` 常驻；有 `applyTo` 仅当匹配「本会话已触及的文件」时注入 |
| `.github/skills/<name>/SKILL.md` | 注册为 DSH skill：名字+描述进会话目录，正文按需加载 |

## 扫描范围

会话 `cwd` 本身 + 它的**直接子目录**（`scanSubdirectories: 1`），各取其 `.github/`；
`.github/instructions/` 内部递归（深度上限 4）。不向上找祖先链，不下探更深的层。

这让 `D:\NEVSTOP-LAB` 这类「多 repo 工作文件夹」成立：文件夹自身和它直接下面的每个 repo
都会贡献自己的 `.github`。

## 安装 / 卸载

```powershell
pwsh -File install.ps1                 # 写入 desktop profile 的 patch 层
pwsh -File install.ps1 -Profile web    # 换 profile
pwsh -File install.ps1 -Uninstall      # 移除
```

脚本幂等：管理块（`# >>> dsh-import-vscode-ai-files >>>` … `# <<< … <<<`）每次重建，
块以上的内容原样保留。

### 热更新：哪些生效、哪些要重启（实测）

| 改什么 | 需要重启吗 |
|---|---|
| 仓库里的 `.github/copilot-instructions.md`、`instructions/`、`skills/` | **不需要** —— 每个 pre-step 重新读盘；内容有变化就追加一条新的注入 |
| `install.ps1` 写入的 patch 行 | **需要** |
| 插件自身的 `src/*.js` | **需要**（Node 的 ESM 缓存） |

「patch 层不热重载」是实测结论，不是猜测：往 patch 里插入一行
`@deepseek-ai/dsh-tool-str-replace-editor` 后，全局工具注册表里始终没有
`str_replace_editor`。DSH 的 profile patch 层在这条 surface 上是一次性组合。

### 重启后的验收清单

1. 在任意含 `.github/copilot-instructions.md` 的目录（例如 `D:\CSM-LLM-WORKSPACE`）
   开会话，GUI 的注入面板里应出现一条**独立的「指令注入 · import-vscode-ai-files」**，
   正文含 `Instructions from: .github/copilot-instructions.md`。
2. 新建一个 `.github/skills/demo/SKILL.md`（`name` + `description` 必填），
   下一次请求应出现在 `skill` 工具目录里，且**无需重启**。
3. 新建 `.github/instructions/x.instructions.md` 且**不写** `applyTo`，应立即注入；
   写上 `applyTo: "**/*.md"` 时，只有本会话读过 `.md` 之后才注入。
4. 改任一文件正文，下一个模型步骤生效。

## 设计取舍（改动前必读）

### 1. host 平面，不是 agent preset 平面

插件**不发布任何 service**，注册进的是注册表层。host 平面注册 = **全局层**，
对每个 preset、每个会话生效 —— 这正是「仓库级配置到处都生效」需要的语义。

曾经尝试 preset 平面并把行放进 `cordis` 的副本，**不可行**：
`@deepseek-ai/dsh-tool-cordis` 在 `lib/index.js` 里无条件
`ctx.cordisInspect.register(provider)` 注册**进程级** Host Inspect provider，没有 realm 隔离。
于是两个含 `tool-cordis` 的 preset 无法在同一进程共存，而 DSH Desktop 正是长驻进程。
实测：把同一份 composition 里唯一一行 `tool-cordis` 禁用后 `standingKeyFor` 立即
`mounted OK`，不禁用则报 `inspect provider "Service" is already registered`。

### 2. 只依赖 3 个 DSH 接缝

| 用途 | 接缝 |
|---|---|
| 注入 instructions | `ctx.on('agent/pre-step', …)` —— 把一条 user 消息折进本步骤的消息批次 |
| 注册 skills | `ctx.skills.registerProvider(create)` —— `list({ cwd })` 由真实消费方带着会话 cwd 调用 |
| 已触及文件 + 目录失效 | `ctx.on('fs/observed', …)` —— `actor` 就是 `ToolExecution`，其 `.agent` 给出会话身份 |

**为什么不用 `systemPrompt.context`**：客户端按 `source.form` 决定一条注入行的形态与标题
（`KNOWN_FORMS = ['instructions','catalog','snapshot','notice','relay','recall']`）。
`systemPrompt.context` 的正文会被收进 `dsh-system-prompt` 那条
「状态快照 · @deepseek-ai/dsh-system-prompt」里，标题不带仓库路径，
看上去就像"根本没注入"。`agent/pre-step` + `source.form = 'instructions'`
才能拿到与 AGENTS.md 同级的独立「指令注入」行。

这条路的代价是两处**内部契约**（升级时优先查，见文末清单）：

1. **注入消息的形状**。profile 本地插件 import 不到 harness 的 `node_modules`，
   所以无法调用 `@deepseek-ai/dsh-llm` 的 `createUserMessage`，只能按字面复刻它的
   四个字段 `{ id, role: 'user', content, source }` 并 deep-freeze。
2. **pre-step decision 的形状**：监听器收到 `{ agent, messages, step, signal }`，
   必须 `await next()`，再返回 `{ …decision, messages }`。

没有 watcher，没有持久化，没有别的内部字段。

### 3. 会话状态按 session id 分桶

host 平面只有**一个实例服务所有会话**，所以 `cwd` 和「已触及文件」集合都按
`agent.id` 分桶（`Map`，上限 64 个会话，超出淘汰最旧的）。
`fs/observed` 里 `actor.agent` 缺失的观察直接丢弃，不外推、不共享 ——
否则 A 会话读一个 `.ts` 会让 B 会话的 `**/*.ts` 指令误激活。

### 4. 不引任何第三方依赖

`frontmatter.js` 与 `glob.js` 都是自己写的极小实现，只允许 `node:` 内置模块。
preset / profile 位于用户 home，Node 向上的 `node_modules` 查找**永远到不了**
harness 自己的依赖。这同时满足「减少依赖」和「DSH 升级不被破坏」。

### 5. 同步 `node:fs`

`discover()` 全程同步：每个 pre-step 都重新读盘，零缓存、零失效逻辑，
所以改文件正文下一步就生效。这也避开了对 `ctx.fs` 服务的依赖。

### 6. 为什么不用 `dsh-agent-instructions` 的 `instructionFileCandidates`

`dsh-agent-instructions` 按「project root → cwd 祖先链」查找 `<dir>/<candidate>`，
与本项目要的「cwd + 直接子目录」是**不同语义**，混用会产生难以解释的重复/遗漏。
三类文件由 `src/` 统一加载，行为一致、可解释。

## DSH 升级后如果失效，按这个顺序查

1. `~/.dsh/profiles/<profile>/cordis.patch.yml` 里的行还在不在（`install.ps1 -Uninstall` 会删掉它）。
2. 三个接缝还在不在：`agent/pre-step`、`skills.registerProvider`、`fs/observed`。
   用 `cordis_inspect_query` 查 `Event.listEvents` 与 `Service.listService` 确认。
3. **注入消息的四个字段**（`id` / `role` / `content` / `source`）与
   **pre-step decision 的形状**（`await next()` 之后返回 `{ …decision, messages }`）。
   对照 `@deepseek-ai/dsh-llm/lib/types/message.js` 的 `createUserMessage`。
   插件里这段整个包在 try/catch 里：形状变了只会记一条 `console.error` 并跳过注入，
   不会弄坏整个 turn。
4. 客户端标题：`dsh-client-ui-trajectory` / `dsh-client-ui-chat` 的
   `contextProvenance` 与 `KNOWN_FORMS` 决定显示成「指令注入」还是「状态快照」。
5. `agent.session.header.cwd` 或 `actor.agent` 还在不在。
   用动态 Cordis 插件打印一次即可（`cordis-plugin-development` skill 有流程）。
6. 先跑 `node --test` 排除是自己的逻辑回归。

## 目录

```
install.ps1         安装/卸载 profile patch 行（幂等）
src/index.js        交付物：Cordis 插件入口（ESM，export default）
src/discover.js     纯函数：扫描 root 列表 → instructions + skills 清单
src/glob.js         applyTo 的极简 glob → RegExp
src/frontmatter.js  极简 YAML frontmatter 解析
test/               node:test 单测（49 项）
fixtures/           测试与演示用的假 repo 结构
```

## 测试

```
node --test test/            # 常规环境
```

沙箱环境下 `node --test` 的并行 runner 会 spawn 子进程并被 pipe 限制挡住（EPERM），
此时逐个文件直接跑即可：

```
node test/glob.test.js
node test/frontmatter.test.js
node test/discover.test.js
node test/index.test.js
```

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
| 仓库里的 `.github/copilot-instructions.md`、`instructions/`、`skills/` | **不需要** —— 每个模型步骤重新读盘 |
| `install.ps1` 写入的 patch 行 | **需要** |
| 插件自身的 `src/*.js` | **需要**（Node 的 ESM 缓存） |

「patch 层不热重载」是实测结论，不是猜测：往 patch 里插入一行
`@deepseek-ai/dsh-tool-str-replace-editor` 后，全局工具注册表里始终没有
`str_replace_editor`。DSH 的 profile patch 层在这条 surface 上是一次性组合。

### 重启后的验收清单

1. 在任意含 `.github/copilot-instructions.md` 的目录（例如 `D:\NEVSTOP-LAB\<某个 repo>`）
   开会话，应看到 `Instructions from: <repo>/.github/copilot-instructions.md`。
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
| 注入 instructions | `ctx.systemPrompt.context({ name, order, text })` —— 回调收到 `{ agent, scope, signal }`，`agent.session.header.cwd` **同步**可读 |
| 注册 skills | `ctx.skills.registerProvider(create)` —— `list({ cwd })` 由真实消费方带着会话 cwd 调用 |
| 已触及文件 + 目录失效 | `ctx.on('fs/observed', …)` —— `actor` 就是 `ToolExecution`，其 `.agent` 给出会话身份 |

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

`systemPrompt.context` 的 `text` 是**同步**函数。用同步 IO ⇒ 零缓存、零状态、
每次组装真的重读磁盘，代码最短，也避开了对 `ctx.fs` 服务的依赖。

### 6. 为什么不用 `dsh-agent-instructions` 的 `instructionFileCandidates`

`dsh-agent-instructions` 按「project root → cwd 祖先链」查找 `<dir>/<candidate>`，
与本项目要的「cwd + 直接子目录」是**不同语义**，混用会产生难以解释的重复/遗漏。
三类文件由 `src/` 统一加载，行为一致、可解释。

## DSH 升级后如果失效，按这个顺序查

1. `~/.dsh/profiles/<profile>/cordis.patch.yml` 里的行还在不在（`install.ps1 -Uninstall` 会删掉它）。
2. 三个接缝的名字有没有变：`systemPrompt.context`、`skills.registerProvider`、`fs/observed`。
   用 `cordis_inspect_query` 查 `Service.listService` 与 `Event.listEvents` 确认。
3. `agent.session.header.cwd` 或 `actor.agent` 还在不在。
   用动态 Cordis 插件打印一次即可（`cordis-plugin-development` skill 有流程）。
4. 先跑 `node --test` 排除是自己的逻辑回归。

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

# DSH-Import-VSCode-AI-Files 设计文档

## 1. 背景与目标

VSCode / Copilot 已经有一套仓库级 AI 配置约定：`.github/copilot-instructions.md`、
带 `applyTo` 作用域的 `.github/instructions/*.instructions.md`、以及
`.github/skills/<name>/SKILL.md`。这些文件天然属于**仓库**，不属于任何单一编辑器。

目标是把它们也喂给 DSH，并且**不要求用户维护第二份配置**：

- 同一份 `.github` 在 VSCode 和 DSH 里都生效；
- 行为尽可能与 VSCode 一致（尤其是 `applyTo` 的作用域语义）；
- 对 DSH 本身的依赖面尽可能小，DSH 升级时坏得少、坏得可见。

## 2. 总体架构

插件是**一个 host 平面的组合行**（`cordis.patch.yml` 里插一行），不做别的：

- 它**不发布任何 service**，所以不需要 `isolate` realm，可以松散地放在 host 组合里；
- host 平面注册进的是注册表的**全局层**，对每个 preset、每个会话生效 ——
  这正是「仓库级配置到处生效」需要的语义；
- 它**没有 Client half**，GUI 里的注入行和技能目录都是既有客户端的既有渲染。

### 2.1 为什么不是 agent preset 平面

preset 平面看起来更"就近"（一次会话一实例），但**走不通**：
`@deepseek-ai/dsh-tool-cordis` 在 `lib/index.js` 里无条件
`ctx.cordisInspect.register(provider)` 注册**进程级** Host Inspect provider，没有 realm
隔离。DSH Desktop 是长驻进程，于是两个含 `tool-cordis` 的 preset 无法共存 ——
把插件放进 `cordis` 的 preset 副本会在挂载时就撞上
`inspect provider "Service" is already registered`。

实测（对照实验）：把同一份 composition 里**唯一**一行 `tool-cordis` 禁用后，
`agentPresets.standingKeyFor` 立即 `mounted OK`；不禁用则失败。这一条排除了 preset 平面。

顺带一提，host 平面还带来两个好处：不必让用户切 preset；`dsh plugin add` 装完即对所有会话生效。

## 3. 关键机制

### 3.1 发现与作用域

`lib/discover.js` 以会话 cwd 为起点，把 cwd 本身和它下面 `scanSubdirectories` 层（默认 1）
的直接子目录各当作一个**项目根**，每个根取自己的 `.github/`。
`.github/instructions/` 内部递归到深度 4。

这样 `D:\NEVSTOP-LAB` 这类「多 repo 工作文件夹」就成立，且各 repo 互不干扰。
**刻意不向上找祖先链** —— 这与 DSH 原生 `dsh-agent-instructions` 的语义不同
（它按 project root → cwd 的祖先链找 `<dir>/<candidate>`）。两者混用会产生难以解释的
重复与遗漏，所以本插件自己管全部三类文件，行为一致、可解释。

`applyTo` 的匹配相对**该文件所属的项目根**，不是工作区根 —— 否则 `src/*.ts` 这种模式在
子 repo 里永远匹配不上。`lib/glob.js` 实现了 `**`、`*`、`?`、`{a,b}`、`[abc]`，并且
**按括号深度切分逗号**（朴素的 `split(',')` 会把最常见的 `**/*.{ts,tsx}` 切成两半）。

没有 `applyTo` 的文件常驻；有的只在会话**真的观察过**匹配文件之后才注入。
「观察过」来自 `fs/observed`。

### 3.2 注入：`agent/pre-step` 与两处内部契约

指令经 `agent/pre-step` 作为一条 **user 消息**折进当前步骤的消息批次，带

```js
source: { kind: 'plugin', plugin: 'import-vscode-ai-files', form: 'instructions' }
```

客户端按 `source.form` 决定一条注入行的形态与标题
（`KNOWN_FORMS = ['instructions','catalog','snapshot','notice','relay','recall']`）。

> **为什么不用 `ctx.systemPrompt.context`**：它的正文会被收进 `dsh-system-prompt` 那条
> 「状态快照 · @deepseek-ai/dsh-system-prompt」里，标题不带仓库路径，看上去就像"根本没注入"。
> `agent/pre-step` + `form: 'instructions'` 才能拿到与 AGENTS.md 同级的独立「指令注入」行。

代价是两处**内部契约**（升级时优先查，见 CONTRIBUTING §4）：

1. **注入消息的形状**。profile 本地插件 import 不到 harness 的 `node_modules`，
   无法调用 `@deepseek-ai/dsh-llm` 的 `createUserMessage`，只能按字面复刻它的四个字段
   `{ id, role: 'user', content, source }` 并 deep-freeze（`id` 用 `node:crypto` 的
   `randomUUID`）。
2. **pre-step decision 的形状**：监听器收到 `{ agent, messages, step, signal }`，
   必须 `await next()`，再返回 `{ …decision, messages }`。

两处都包在 try/catch 里：形状变了只记一条 `console.error` 并跳过注入，不会弄坏整个 turn。

### 3.3 注入顺序

`agent/pre-step` 是 waterfall，而**所有**注入监听器都插在同一个位置（已领取消息之后），
所以**谁最后跑谁占前面**。本行在 host 平面、先于 preset 挂载注册，用"插在已领取消息之后"
会把 `.github` 规则排到 AGENTS.md **前面**。

因此这里**追加到末尾**：顺序与注册顺序无关 —— AGENTS.md 在前，`.github` 规则在后。

### 3.4 会话状态按 session id 分桶

host 平面只有**一个实例服务所有会话**，所以每个会话的 `cwd`、「已触及文件」集合、
以及"上次注入了什么"都按 `agent.id` 分桶（`Map`，上限 64 个会话，超出淘汰最旧的）。

`fs/observed` 里 `actor.agent` 缺失的观察**直接丢弃**，不外推、不共享 ——
否则 A 会话读一个 `.ts` 会让 B 会话的 `**/*.ts` 指令误激活。

内容变化时**追加**一条新注入（旧的留在历史里），文件消失时先给一条
`Instructions removed:`，避免模型继续依据已失效的规则。

### 3.5 技能注册

`ctx.skills.registerProvider` 注册一个 provider：

- `list({ cwd })` 每次重新扫盘；`cwd` 由真实消费方（`dsh-tool-skill`）带着会话 cwd 传入。
- `get(candidate)` 每次重新读正文，所以改文件不需要任何失效逻辑。
- `source: 'project-vscode'`、`rank: 150`（夹在内置的 `project-dsh`(100) 与
  `project-agents`(200) 之间）、`resourceBase` 指向 bundle 目录，让 bundle 内的
  `references/` 可被引用。
- `disable-model-invocation` / `user-invocable` 与原生语义一致；拼写非法则丢弃该技能并告警。

目录失效：provider 是全局的、一个实例服务所有工作区，所以**任何** `.github` 路径的观察
都会调用 `control.invalidate()`，而不是只认当前会话 cwd 下的。

### 3.6 字节预算

`maxBytes`（默认 65536）限制单次注入。规则：先省略整份较宽泛的文件，再截断最后一份，
并在正文里写明丢了多少、截断了什么。**渲染结果绝不超出预算** —— 包括"省略提示"自身的
预留，以及 `[truncated]` 后缀的长度。

### 3.7 零依赖与同步 IO

`frontmatter.js` 与 `glob.js` 都是自己写的极小实现，只用 `node:` 内置模块。
原因不是洁癖：profile 本地插件向上找不到 harness 自己的 `node_modules`，
任何 `@deepseek-ai/*` 或第三方 import 都会在加载期失败。

IO 全部同步（`discover()` 是同步函数）：零缓存、零失效逻辑，每个 pre-step 直接重读磁盘。
代价是每步的文件系统开销（几十次 stat/readdir，亚毫秒级），换来的是"改文件下一步生效"
这个用户可见的性质。

## 4. 源码结构

| 文件 | 职责 |
| --- | --- |
| `index.js` | 插件入口：`agent/pre-step` 注入、skill provider、`fs/observed` |
| `lib/discover.js` | 扫描项目根，产出 instructions 与 skills |
| `lib/frontmatter.js` | 极简 YAML frontmatter（标量、引号、`\|` `>` 块、行内与列表数组、注释） |
| `lib/glob.js` | `applyTo` 的 glob → RegExp，含括号感知的逗号切分 |

## 5. 验证记录

### 5.1 接缝实测（2026-09-18，Desktop 2.0.11 / dsh 0.1.5-rc.2）

| 接缝 | 结论 |
| --- | --- |
| `agent/pre-step` | 注入的 `form: 'instructions'` 消息确实到达模型，GUI 显示为独立「指令注入」行，标题取自 `source.plugin` |
| `skills.registerProvider` | `list({ cwd })` 收到真实 cwd；`get()` 返回正文与 `resourceBase`；`invocation` 策略与 frontmatter 一致 |
| `fs/observed` | `actor` 是 `ToolExecution`，携带 `.agent`（`id` 与 `session.header.cwd`），可按会话分桶 |

另记两条否证，它们塑造了当前形态：

- `ctx.systemPrompt.context` 的正文会被折叠进「状态快照」条目 —— 内容送达没问题，
  但用户按标题扫过去会认为"没有注入"。
- `dsh-tool-cordis` 的进程级 Inspect provider 排除了 preset 平面（§2.1）。

### 5.2 端到端

在一个真实工作区验证了 5 份指令文件的注入、`applyTo` 的负例（未命中不注入）、
正文改动下一步生效、`Instructions removed:`、技能进目录、以及 `/name` 调用。

### 5.3 离线

`npm run check`：5 个文件的 `node --check` + 56 项 `node:test`。
`test/index.test.js` 对着假 Cordis 上下文驱动真实插件对象，覆盖注入顺序、跨会话隔离、
预算边界、`applyTo` 正反例与移除通知。

## 6. 已知边界与后续

- **不监视文件**：没有 watcher。`.github` 的增删改在"下一个模型步骤"生效（因为每步重读），
  但**技能目录**还需要一次失效信号；当前由 `fs/observed` 提供。
- **只读**：插件不写任何文件。
- **不覆盖** `.github/prompts/*.prompt.md`、`.github/agents|chatmodes/*.md`、
  `.vscode/settings.json` 里的指令路径，也不兼容 `.claude/skills` 等其他技能根。
- **子 agent 也会注入**：host 平面注册是全局的，所以子 agent 的组装同样带这些指令。
- **恢复会话时可能重复注入一次**：`injectedText` 是内存态，进程重启后第一次组装会重新注入。
  无害，但会多一条消息。

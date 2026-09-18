# 变更记录

本文件记录每个发布版本的用户可见变更。发布工作流
（[`.github/workflows/release.yml`](./.github/workflows/release.yml)）会调用
`scripts/release-notes.mjs`，把与 tag 对应的 `## [<版本>]` 小节抄进 GitHub Release
正文——所以**发版前先在这里写一节**，否则 Release 只会退化成提交列表。

## [Unreleased]

### 新增

- **工作区之外的路径**（[#2](https://github.com/NEVSTOP-LAB/dsh-import-vscode-ai-files/issues/2)）：
  新增配置字段 `paths`，每个路径按与 cwd **完全相同**的规则扫描（它自己 + 同样层数的直接
  子目录），因此「一份共享 `.github` 放在工作区外、所有仓库共用」不需要第二套机制。
  路径可绝对可相对 cwd；不存在的路径贡献为空，重复点名一个已经扫过的目录也不会被走第二遍
  （第二遍会重新拿到一整层下探预算，从而多扫出本来不该有的一层）。
  通过 `paths` 扫到的指令用**绝对路径**做标题（`..\..` 链说不清位置），`applyTo` 仍相对
  该文件自己的项目根匹配。
- **在「插件页」里配置路径**：插件现在注册一个 DSH 设置命名空间 `import-vscode-ai-files`
  （组合配置作为 base 层），并带上一个 browser half —— **设置 → 插件 → 插件配置** 里本插件
  的那张卡片可以逐行增删路径，并保存、放弃或恢复默认。
  - 保存带草稿开始时的 revision，被并发改动抢先就拒绝而不是覆盖；保存后以宿主回读的值确认。
  - 保存会立即让技能目录失效 —— 设置写入不碰文件系统，否则新路径下的技能要等到下一次
    无关的文件观察才会进目录。
  - 「放弃」只丢弃未保存的草稿；清掉已存储的用户覆盖用「恢复默认」（字段被覆盖时才出现）。
  - 落点是 DSH 自己的用户设置文档（`$DSH_HOME/settings.yaml`），工作区文件一个不写；该文档
    热重载，改完从下一个模型步骤起生效。
  - 卡片只覆盖 `paths`；其余字段仍只在组合配置里。
  - `settings` 服务不可用时，插件照常按组合配置运行，只是没有这张卡片。

### 设计取舍

- **schema 必须是真 schemastery，且惰性加载**：浏览器要靠 `schema.toJSON()` 的
  `{ uid, refs }` 信封重建 schema 才能渲染表单，手写的「形状像」的对象会让卡片静默地拿不到
  值。为保住「clone 下来零依赖即可 `npm run check`」这条性质，`@deepseek-ai/schemastery`
  只以惰性动态 import 出现在 `index.js` 一处，且只在 `settings` 服务存在时执行。
- **卡片是手写的 lazy-CJS bundle**，不引入构建步骤——与第三方插件（如 `dsh-git-rollback`）
  的做法一致。

### 验证

- `npm run check`：9 个文件的 `node --check` + 96 项 `node:test` 全绿
  （glob 9 / frontmatter 9 / discover 24 / 插件 35 / 设置 8 / 客户端 bundle 11）。
  插件那 35 项里包含一条**端到端**：设置服务给出的 `paths` 真的进了发现流程（注入与技能目录），
  以及 schema 装载失败时组合配置继续生效。客户端那 11 项跑的是**真实的 `lib/client.js`**：
  按客户端模块系统的方式执行 bundle，再驱动 `apply(ctx)` 与卡片组件，覆盖注册 key、暂存、
  保存（revision + 回读确认）、恢复默认（`unset`）、只读态、样式安装/卸载。
- `npm run verify:settings`：拿真实 `@deepseek-ai/schemastery`（本机 Desktop 2.0.11）
  把设置链走一遍 9/9 —— 解析组合配置与用户层、拒绝非法写入、`toJSON()` 信封、
  **从信封重建并校验**（浏览器渲染卡片走的就是这一步），以及两半的 namespace 是同一个字符串。
  该命令在没有安装 DSH 的环境下跳过并退 0，所以不进 `npm run check`。
- 设置这条链（`installSection` 签名与 hooks、namespace 文法、卡片按 namespace 派发、
  `dsh.client` 的解析规则与 bundle 缺失时的失败方式、scope 的 `bind`/`mutate` 形状）
  **读实现**逐条核对；本机已挂载 `dsh-settings-file`、`$DSH_HOME/settings.yaml` 可写。
- **还没实测**：卡片在真实 GUI 里出现、保存落盘与生效、「恢复默认」回到组合配置。
  清单与手工步骤见 [CONTRIBUTING §2.3 / §4.3](./CONTRIBUTING.md)。

## [0.1.0] - 2026-09-18

### 新增

- **首次发布**：把工作区自带的 VSCode / Copilot 风格 AI 配置加载进每一个 DSH 会话。
  - `.github/copilot-instructions.md` 常驻注入。
  - `.github/instructions/**/*.instructions.md` 按 `applyTo` 作用域注入：没有 `applyTo`
    的常驻；有 `applyTo` 的，只在本会话真的碰过匹配文件之后才注入。匹配相对该文件所属的
    项目根，支持 `**`、`*`、`?`、`{a,b}`、`[abc]` 与逗号分隔的多模式。
  - `.github/skills/<name>/SKILL.md` 注册为 DSH 技能，`disable-model-invocation` 与
    `user-invocable` 与原生语义一致。
- **扫描范围**：会话 cwd 本身，加上它下面 `scanSubdirectories` 层（默认 1）的直接子目录，
  各取自己的 `.github/`；`.github/instructions/` 内部递归到深度 4。
- **独立可辨认的注入行**：指令经 `agent/pre-step` 作为一条带
  `source = { kind: 'plugin', plugin: 'import-vscode-ai-files', form: 'instructions' }`
  的 user 消息注入，因此在 GUI 里显示为与 AGENTS.md 同级的「指令注入」条目，
  而不是折叠进 `@deepseek-ai/dsh-system-prompt` 的状态快照里。
- **顺序固定**：AGENTS.md 在前，`.github` 指令在后（见 CONTRIBUTING §6 的注入顺序一条）。
- **内容变化即追加**：渲染结果变化时追加一条新注入；文件消失时先给一条
  `Instructions removed:`，不静默丢弃。
- **字节预算**：`maxBytes`（默认 65536）先省略、再截断，并在正文里说明丢了多少；
  渲染结果**绝不超出**该预算（含提示文本自身的预留）。

### 设计取舍

- **host 平面**而非 agent preset 平面：插件不发布任何 service，host 平面注册即全局层，
  对每个 preset、每个会话生效。preset 平面不可行——`@deepseek-ai/dsh-tool-cordis`
  无条件注册进程级 Host Inspect provider，两个含它的 preset 无法在同一进程共存。
- **零第三方依赖**：profile 本地插件向上找不到 harness 自己的 `node_modules`，
  因此 frontmatter 与 glob 都是自己写的极小实现，只用 `node:` 内置模块，
  `peerDependencies` 为空。

### 验证

- `npm run check`：6 个文件的 `node --check` + 58 项 `node:test` 全绿
  （glob 9 / frontmatter 9 / discover 13 / 插件 27，其中插件部分对着假 Cordis 上下文
  驱动真实的 `agent/pre-step` 瀑布、skill provider 与 `fs/observed` 监听器）。
- 三条接缝在真实运行时逐条实测：`agent/pre-step` 注入的 `form: 'instructions'` 消息确实
  到达模型并被 GUI 标成独立注入行；`skills.list/get` 对真实工作区返回正确的策略与正文；
  `fs/observed` 的 `actor` 携带 `.agent`，可按会话分桶。
- 端到端：在一个真实工作区验证了 5 份指令文件的注入、`applyTo` 的负例（未命中不注入）、
  正文改动下一步生效、以及技能进目录与被 `/name` 调用。

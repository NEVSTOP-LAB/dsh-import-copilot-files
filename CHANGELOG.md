# 变更记录

本文件记录每个发布版本的用户可见变更。发布工作流
（[`.github/workflows/release.yml`](./.github/workflows/release.yml)）会调用
`scripts/release-notes.mjs`，把与 tag 对应的 `## [<版本>]` 小节抄进 GitHub Release
正文——所以**发版前先在这里写一节**，否则 Release 只会退化成提交列表。

## [Unreleased]

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

- `npm run check`：5 个文件的 `node --check` + 56 项 `node:test` 全绿
  （glob 9 / frontmatter 9 / discover 13 / 插件 26，其中插件部分对着假 Cordis 上下文
  驱动真实的 `agent/pre-step` 瀑布、skill provider 与 `fs/observed` 监听器）。
- 三条接缝在真实运行时逐条实测：`agent/pre-step` 注入的 `form: 'instructions'` 消息确实
  到达模型并被 GUI 标成独立注入行；`skills.list/get` 对真实工作区返回正确的策略与正文；
  `fs/observed` 的 `actor` 携带 `.agent`，可按会话分桶。
- 端到端：在一个真实工作区验证了 5 份指令文件的注入、`applyTo` 的负例（未命中不注入）、
  正文改动下一步生效、以及技能进目录与被 `/name` 调用。

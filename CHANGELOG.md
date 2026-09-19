# 变更记录

本文件记录每个发布版本的用户可见变更。发布工作流
（[`.github/workflows/release.yml`](./.github/workflows/release.yml)）会调用
`scripts/release-notes.mjs`，把与 tag 对应的 `## [<版本>]` 小节抄进 GitHub Release
正文——所以**发版前先在这里写一节**，否则 Release 只会退化成提交列表。

## [Unreleased]

### 新增

- **工作区之外的配置目录**（[#2](https://github.com/NEVSTOP-LAB/dsh-import-vscode-ai-files/issues/2)、
  [#6](https://github.com/NEVSTOP-LAB/dsh-import-vscode-ai-files/issues/6)）：
  新增配置字段 `paths`。该字段尚未随任何版本发布，所以没有需要迁移的旧配置。
  每个条目是一个**配置目录**，等价于项目根里的 `.github`：`paths: [D:\shared-ai]` 读的是
  `D:\shared-ai\copilot-instructions.md`、`D:\shared-ai\instructions\**` 与
  `D:\shared-ai\skills\<name>\SKILL.md`，它下面**不再有** `.github` 段；条目自身的走查也不会去
  读它内部的 `.github` 树（若该目录同时落在 cwd 走查范围内，那棵树仍可能以**项目根的**
  `.github` 身份被读到 —— 那是 cwd 侧的规则，两侧互不影响）。路径可绝对可相对 cwd；不存在的
  路径贡献为空；已经被扫过的配置目录不会被走第二遍；每个条目恰好是一个配置目录，因此
  `scanSubdirectories` 不作用于它（它的子目录是内容，不是更多的配置目录）。通过 `paths` 扫到的
  指令用**绝对路径**做标题（`..\..` 链说不清位置），`applyTo` 相对该条目自身匹配。
  注：把一个**位于 cwd 走查范围之外**的仓库根改写成 `paths: [<repo>/.github]` 也能工作，但
  `applyTo` 的锚点会从仓库根移到 `.github`；若那个仓库本来就在 cwd 走查范围内，它已经作为
  项目根被读到，改名到 `paths` 只会被去重、不改变锚点。cwd 侧的扫描规则一字未动。
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

### 变更

- **卡片标题改为「导入 VSCode AI 文件」**（[#5](https://github.com/NEVSTOP-LAB/dsh-import-vscode-ai-files/issues/5)）：
  英文界面为 `Import VSCode AI Files`；卡片的说明改为「把工作区以外的 VSCode AI 配置也加载进来」，
  提示改成「每行是一个配置目录，等价于项目里的 `.github`」，不再说「项目根」。
- **卡片改用「插件配置」页其他插件的形态**：折叠的标题栏（名称 + 说明 + 展开箭头，行内显示
  「未保存」标记）、展开后的字段（label + 提示 + 输入框）、右下角的「放弃 / 保存」，字段被
  覆盖时行内给「已覆盖」标记与「恢复默认」。配色、圆角与边框全部走同一套设计 token，
  与宿主自己的 `PluginCard` 逐类对齐；保存被宿主接受后卡片自动收起。

### 修复

- **配置目录里的改动会立即让技能目录失效**：失效触发原先只认路径里的 `/.github/`，而 `paths`
  条目自身没有这一段，于是改 `<路径>/skills/**/SKILL.md` 不会刷新技能目录（要等下一次无关的
  文件观察）。现在命中 `.github` 树、或落在任一 `paths` 条目之下（按会话 cwd 解析、比较时按
  分隔符边界、Windows 大小写不敏感）都会失效。
- **「浏览…」不再点了没反应**：DSH Desktop 在 Windows 上禁用自适应选择器、改挂 `browse`
  后端，而 `browse` 没有 `pick` 能力 —— `uiWorkspace.pickDirectory()` 在那里必然被拒，
  旧的 `void browse().then(…)` 会把这次 rejection 丢进控制台，按钮看上去是坏的。
  现在按部署能用的路由取目录：DSH Desktop 窗口用它自己的 Windows 选择框
  （`window.__DSH_DESKTOP_PICK_DIRECTORY__`），其余组合走宿主的原生选择器；两条都不存在时
  卡片显示一条提示让人手填路径。

### 设计取舍

- **schema 必须是真 schemastery，且惰性加载**：浏览器要靠 `schema.toJSON()` 的
  `{ uid, refs }` 信封重建 schema 才能渲染表单，手写的「形状像」的对象会让卡片静默地拿不到
  值。为保住「clone 下来零依赖即可 `npm run check`」这条性质，`@deepseek-ai/schemastery`
  只以惰性动态 import 出现在 `index.js` 一处，且只在 `settings` 服务存在时执行。
- **卡片是手写的 lazy-CJS bundle**，不引入构建步骤——与第三方插件（如 `dsh-git-rollback`）
  的做法一致。
- **不处理 AGENTS.md**：它属于 DSH 核心的 `dsh-agent-instructions`（按 project root → cwd 的
  祖先链读取），所以只在当前工作目录这条链上生效；`paths` 与子目录根都不贡献 AGENTS.md。
  这条边界由负例测试钉住（配置目录里放一个 AGENTS.md，注入文本里不得出现它），
  避免以后有人「顺手」把它也扫进来。
- **配置目录是唯一的扫描单位**：cwd 走查产出的是「项目根 + 它的 `.github`」，`paths` 条目
  产出的就是它自己。两者只在 `rootDir`（`applyTo` 的匹配锚点）上分叉，其余解析共用一条
  代码路径，所以 `.github` 语义不会在两侧漂移。

### 验证

- `npm run check`：9 个文件的 `node --check` + 114 项 `node:test` 全绿
  （glob 9 / frontmatter 9 / discover 31 / 插件 39 / 设置 8 / 客户端 bundle 18）。
  插件那 39 项里包含一条**端到端**：设置服务给出的 `paths` 真的进了发现流程（注入与技能目录），
  以及 schema 装载失败时组合配置继续生效。客户端那 18 项跑的是**真实的 `lib/client.js`**：
  按客户端模块系统的方式执行 bundle，再驱动 `apply(ctx)` 与卡片组件，覆盖注册 key、折叠/展开、
  暂存、保存（revision + 回读确认）、恢复默认（`unset`）、只读态、两条目录选择路由、
  选择被拒时的提示与取消时不动草稿、样式安装/卸载，以及卡片标题就是「导入 VSCode AI 文件」。
- **配置目录语义的负例**都在 `test/discover.test.js` 里：配置目录内部的 `.github` 树
  （copilot / instructions / skills 三样）一律不被采纳 —— 包括 `instructionDirs` 取
  `'.'`、`'.github'`、`'./.github'`、`'x/.github/y'`、`''`、`'/'` 这些退化写法；它的子目录不被
  当作更多的配置目录（`sub-dir/copilot-instructions.md` 与 `sub-dir/.github/**` 各放一份负例，
  只放 `.github` 那种看不见「把子目录当配置目录」的重构）；`paths` 指向的目录里的 `AGENTS.md`
  不被采纳；两个扫描单位落到同一个源文件时只出现一次（`paths: ['.']` + 自定义目录名）。
  Windows 上 `.github\instructions` 与 `.github/instructions` 等价。插件侧再补三条：
  「配置目录里的改动会让技能目录失效」、大小写不同的同一路径同样会失效，以及会话还没有 cwd 时
  相对路径的条目不会被错误地解析（绝对路径仍然照常生效）。
- `npm run verify:settings`：拿真实 `@deepseek-ai/schemastery`（本机 Desktop 2.0.11）
  把设置链走一遍 9/9 —— 解析组合配置与用户层、拒绝非法写入、`toJSON()` 信封、
  **从信封重建并校验**（浏览器渲染卡片走的就是这一步），以及两半的 namespace 是同一个字符串。
  该命令在没有安装 DSH 的环境下跳过并退 0，所以不进 `npm run check`。
- 设置这条链（`installSection` 签名与 hooks、namespace 文法、卡片按 namespace 派发、
  `dsh.client` 的解析规则与 bundle 缺失时的失败方式、scope 的 `bind`/`mutate` 形状）
  **读实现**逐条核对；本机已挂载 `dsh-settings-file`、`$DSH_HOME/settings.yaml` 可写。
- 目录选择的两条路由**读实现**核对：win32 的 DSH Desktop profile 禁用
  `dsh-host-directory-picker-auto` 并改挂 `browse` 后端，`browse` 没有 `pick`，Remote 控制器
  按 `requireCapability('native', 'pick')` 答 `directory-picker/unavailable`；
  `window.__DSH_DESKTOP_PICK_DIRECTORY__` 只在 win32 页面上安装。
- **还没实测**：卡片在真实 GUI 里出现、保存落盘与生效、「恢复默认」回到组合配置、
  以及修好后的「浏览…」在 DSH Desktop 窗口里真的弹出选择框。
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

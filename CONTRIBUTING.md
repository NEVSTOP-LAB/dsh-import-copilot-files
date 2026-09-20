# 贡献指南（CONTRIBUTING）

面向维护者与二次开发。用户可见的功能、安装与配置见 [README.md](./README.md)，
架构与关键机制见 [doc/design.md](./doc/design.md)。

本文档是**开发流程、依赖面与验证方法**的出处：README 只陈述用户需要知道的事实，
原因、判定依据与操作步骤都在这里。

## 目录

- [1. 目录结构](#1-目录结构)
- [2. 本地开发与检查](#2-本地开发与检查)
- [3. 依赖面与兼容性](#3-依赖面与兼容性)
- [4. 兼容性校验怎么做](#4-兼容性校验怎么做)
- [5. 打包与发版](#5-打包与发版)
- [6. 开发坑](#6-开发坑)

## 1. 目录结构

```
dsh-import-vscode-ai-files/
├── README.md            # 用户可见：功能、安装、配置
├── README.en.md         # 同上（英文）
├── CONTRIBUTING.md      # 本文档
├── CHANGELOG.md         # 每个版本的变更；发布正文的来源
├── doc/design.md        # 设计文档：架构与关键机制
├── package.json         # bundle manifest（dsh.bundle.patch）与 client manifest（dsh.client）
├── cordis.patch.yml     # 组合层：插入插件行
├── index.js             # 插件入口：指令注入 + skill provider + fs/observed + 设置接线
├── lib/
│   ├── discover.js      # 扫描配置目录（cwd 各项目根的 .github + paths 条目自身），产出 instructions 与 skills
│   ├── frontmatter.js   # 极简 YAML frontmatter
│   ├── glob.js          # applyTo 的极简 glob → RegExp
│   ├── settings.js      # 设置命名空间的 schema（z 由调用方传入，可离线测试）
│   └── client.js        # browser half：设置卡片（手写 lazy-CJS bundle）
├── scripts/
│   ├── release-notes.mjs# 由 CHANGELOG 组装 Release 正文（零依赖）
│   ├── pack.mjs         # 跨平台打包（npm pack → dist/）
│   └── verify-settings-schema.mjs # 拿真实 schemastery 复核设置链（§4.2）
└── test/
    ├── *.test.js        # node:test
    └── fixtures/        # 假的 repo 结构，供测试与手工验证
```

Host half 是 `index.js`；Client half 只有一张设置卡片（`lib/client.js`，§2.3）。
GUI 里看到的那条注入行是既有客户端对 `source.form` 的既有渲染，不需要我们注册任何 UI；
技能目录同理。

## 2. 本地开发与检查

仓库**没有 `node_modules`，也不安装依赖**：检查脚本只用 Node 内置模块，clone 下来直接跑。

```sh
npm run check
```

等价于：

```sh
node --check index.js
node --check lib/discover.js
node --check lib/frontmatter.js
node --check lib/glob.js
node --check lib/settings.js
node --check lib/client.js
node --check scripts/pack.mjs
node --check scripts/release-notes.mjs
node --check scripts/verify-settings-schema.mjs
npm test          # node --test test/
```

> [!NOTE]
> 受限沙箱里 `node --test` 的并行 runner 会 spawn 子进程并被 pipe 限制挡住（EPERM）。
> 那种环境下逐个文件直接跑即可，六个测试文件都支持单独执行：
> `node test/glob.test.js`、`node test/frontmatter.test.js`、`node test/discover.test.js`、
> `node test/index.test.js`、`node test/settings.test.js`、`node test/client.test.js`。
> 另外 Windows 检出默认 `core.autocrlf=true`，fixture 在盘上是 CRLF，所以对正文做逐字
> 比较的断言要先按 EOL 归一化（`test/index.test.js` 里那条就是），否则 `npm run check`
> 会在一台机器上红、在 CI（ubuntu）上绿。

### 2.1 测试用什么驱动

`test/index.test.js` **不需要 DSH**：它对着一个假的 Cordis 上下文驱动**真实的插件对象** ——
按真实语义跑 `agent/pre-step` 瀑布（含 `next()` 链）、真实的 skill provider、真实的
`fs/observed` 监听器。所以绝大多数行为 clone 之后立刻可验证。它还带一条端到端：把设置服务
给的值换掉之后，`paths` 真的出现在下一次注入与技能目录里（`mount(..., { settings: true })`
提供的是一个假 `settings` 服务，schema loader 由 `apply` 的 `options.loadSchema` 注入 ——
真实 loader 需要 DSH 安装，见 §4.2）。

`test/settings.test.js` 把 schema loader 注入进去，所以它能在没有 `@deepseek-ai/schemastery`
的 checkout 里钉住命名空间的接线；`test/client.test.js` **跑的是真实的 `lib/client.js`** ——
它按客户端模块系统的方式执行那个 bundle（假的 `window.__ModuleLoader__`、假的 `require`、
一个 React 替身），再驱动 `apply(ctx)` 与卡片组件，包括暂存、保存（revision 与回读确认）、
只读态与样式安装/卸载。

每次改行为，先问「这条能被 `node --test` 钉住吗」。不能的部分才留给人眼验证（§2.2）。

### 2.2 端到端验证（可选）

三条 host 接缝都可以用动态 Cordis 插件在真实会话里探针验证，不必改仓库代码：

1. `agent/pre-step` —— 注册一个监听器，注入一条带
   `source = { kind: 'plugin', plugin: 'probe', form: 'instructions' }` 的消息，
   确认它作为 user 消息到达模型，并在 GUI 注入面板里显示成**独立条目**（标题取自
   `source.plugin`）。
2. `skills.list({ cwd })` / `skills.get(name, { cwd })` —— 确认 provider 对该工作区返回的
   `invocation` 策略、`resourceBase` 与正文。
3. `fs/observed` —— 确认 `actor.agent` 存在（按会话分桶的前提）。

`cordis-plugin-development` skill 里有完整流程。

### 2.3 设置卡片怎么验证

卡片只有在**装好的 profile 里、DSH 重启之后**才会出现，所以它没有 §2.1 之外的自动化路径：

1. `npm run pack`，再 `dsh plugin --profile <p> add ./dist/dsh-import-vscode-ai-files-<v>.tgz`，
   然后**重启 DSH**（profile patch 层不热重载）。
2. 打开 **设置 → 插件 → 插件配置**，确认本插件那张卡片出现，标题与「导入 VSCode AI 文件」
   （英文界面 `Import VSCode AI Files`）一致 —— 出现本身就说明四件事同时成立：host 注册了
   namespace、`dsh.client` 被扫描到、bundle 被 `/plugins` 提供、卡片的 slot key 与 namespace 相同。
3. 点开卡片的标题栏，确认展开后的字段与页脚，以及行内的「浏览…」：在 DSH Desktop 窗口里按它
   应弹出 Windows 系统选择框，选中的目录直接填进那一行（仍是未保存的草稿，要再点「保存」）。
4. 加一个真实存在的共享配置目录、保存，然后确认两件事：`$DSH_HOME/settings.yaml` 里出现
   `import-vscode-ai-files:` 小节；新会话的「指令注入」行里出现该目录下的指令
   （标题是绝对路径）。注意该目录**自己**就是 `.github` 的等价物：直接放
   `copilot-instructions.md`、`instructions/`、`skills/`，不要在它下面再建 `.github`。
5. 「恢复默认」（字段被覆盖时才出现）应清掉用户覆盖，值回到 `cordis.patch.yml`；
   「放弃」只应丢弃未保存的草稿，不动已存储的值。
6. 未实测清单见 §4.2——**做完这几步就把对应条目划掉**。

## 3. 依赖面与兼容性

### 3.1 加载期零依赖

`dependencies` 为空，加载期的 import 只有 `node:crypto`、`node:fs`、`node:os`、`node:path`。
`peerDependencies` 列出宿主契约 —— `@deepseek-ai/cordis`、`@deepseek-ai/dsh-settings`、
`@deepseek-ai/schemastery`、`react` —— 并且**四个全部是 optional**（`peerDependenciesMeta`）：
这个插件在 profile 里本来就能缺其中任何一个（缺 schemastery 或 settings 只丢那张卡片），
而 optional 的 peer 不会进 pnpm 的 peer 问题清单，所以这条声明不制造新警告。声明的作用是让
manifest 如实描述「跑起来需要什么」，也让 `resolveModuleFallbackEntries` 这类按
`dependencies` + `peerDependencies` 走的解析器认得它。

`peerDependencies` 不是 `dependencies` 的替代品：它**不会被安装**，插件仍然不能假定
`@deepseek-ai/*` 一定解析得到。插件的宿主半侧跑在 harness 进程里，
但模块解析走的是 **profile 的 `node_modules`**，而那条路径是部署给的、不保证有什么 ——
所以 `lib/frontmatter.js` 与 `lib/glob.js` 只能自己写。这条约束直接决定了 §3.2 的形态。

唯一的例外是 `@deepseek-ai/schemastery`（设置 schema 必须是真的 schemastery，见 §4.2），
它由 DSH 的包带进 profile 共享的 `node_modules`，实测可解析：以**装好的**插件路径为基准
`createRequire('…/profiles/<p>/node_modules/dsh-import-vscode-ai-files/lib/index.js').resolve('@deepseek-ai/schemastery')`
解析到 Desktop 自带的那份副本。即便如此也只用**惰性动态 import**：`index.js` 里只有
`import('@deepseek-ai/schemastery')` 一处，且只在 `settings` 服务存在时才执行。所以 clone
下来没有 `node_modules` 也能 `npm run check`；反过来，某个 profile 真的解析不到它时，丢的是
设置卡片，不是整个插件（`attachSettings` 的 catch 会打一条 `console.error`）。

`lib/settings.js` 因此不 import 任何东西：`z` 由调用方传入，所以 schema 的形状能离线测试。

### 3.2 对 DSH 的依赖是 5 个接缝 + 3 处内部契约

| 用途 | 接缝 |
| --- | --- |
| 注入 instructions | `ctx.on('agent/pre-step', …)` |
| 注册 skills | `ctx.skills.registerProvider(create)` |
| 已触及文件 + 目录失效 | `ctx.on('fs/observed', …)` |
| 设置命名空间（可选服务） | `ctx.inject(['settings'], …)` → `settings.installSection(…)` |
| 设置卡片（browser half） | `ctx.settingsScope.bind({ namespace })`、`ctx.slots.register({ name: 'settings.plugin.item', key })`、`ctx.locale.register` |
| 卡片的「浏览…」（browser half） | `ctx.get('uiWorkspace').pickDirectory()`，或 DSH Desktop 在 win32 页面上装的 `window.__DSH_DESKTOP_PICK_DIRECTORY__` |

接缝之外还有三处**内部契约**：

1. 注入消息的四个字段（详见 [doc/design.md §3.2](./doc/design.md)）；
2. pre-step decision 的形状；
3. `settings.plugin.item` 的 slot key **就是设置命名空间**（[doc/design.md §3.8](./doc/design.md)）。

前两处整个包在 try/catch 里 —— 形状变了只记一条 `console.error` 并跳过注入，不会弄坏整个
turn。第三处没有 try/catch 可包：key 与 namespace 不一致时卡片**安静地不渲染**，所以两半
各自被测试钉住（`test/settings.test.js` / `test/client.test.js`），并由
`npm run verify:settings` 直接比对两个字符串（§4.2）。

### 3.3 版本要求

加载期不 import 任何 DSH 包，所以兼容性由 §3.2 的清单决定；`peerDependencies` 里的范围只是
契约记录（全 optional，不会被安装，也不会拦安装）。
**实测环境：DSH Desktop 2.0.11 / dsh `0.1.5-rc.2`**（与 `dsh-approval-mode` 相同）。

## 4. 兼容性校验怎么做

升级 DSH 之后，按顺序查：

1. `dsh --profile <profile> --dump-config` 里还有没有 `dsh-import-vscode-ai-files` 行。
2. 五个接缝还在不在 —— 用 `cordis_inspect_query` 查 `Event.listEvents` 与
   `Service.listService`（`settings`、`skills`），以及客户端的 `Slots.listSubTree`
   （`settings.plugin.item` / `settings.plugins.tab` 是否仍由「插件配置」标签页声明）。
3. 注入消息的四个字段（`id` / `role` / `content` / `source`）与 pre-step decision 的形状
   （`await next()` 之后返回 `{ …decision, messages }`）—— 对照
   `@deepseek-ai/dsh-llm/lib/types/message.js` 的 `createUserMessage`。
4. 客户端标题：`dsh-client-ui-trajectory` / `dsh-client-ui-chat` 的 `contextProvenance`
   与 `KNOWN_FORMS` 决定显示成「指令注入」还是「状态快照」。
5. `agent.session.header.cwd` 或 `actor.agent` 还在不在。
6. 设置这条链：`dsh-settings` 的 `installSection` 签名与 `hooks`（`setSource` / `onChange`）、
   `dsh-client-ui-settings` 的 `bind(spec)` 与 scope 方法、`dsh-client-modules` 对
   `dsh.client`（`platform` / `exports['./client']`）的解析规则。这三处是本插件唯一
   「跟着上游内部形状走」的地方。
7. 卡片的目录选择：`uiWorkspace.pickDirectory()` 还在不在，以及 win32 的 DSH Desktop
   profile 是否仍然禁用 `dsh-host-directory-picker-auto`（改挂 `browse` 后端时
   `pick` 会被 Remote 拒绝），`window.__DSH_DESKTOP_PICK_DIRECTORY__` 是否仍被安装。
8. 先跑 `npm run check` 排除自己的逻辑回归。

### 4.1 校验记录

| 日期 | DSH | 结论 |
| --- | --- | --- |
| 2026-09-18 | Desktop 2.0.11 / dsh 0.1.5-rc.2 | 三个接缝与两处内部契约逐条实测通过；端到端验证见 CHANGELOG `0.1.0` 的「验证」小节 |
| 2026-09-21 | Desktop 2.0.11 / dsh 0.1.5-rc.2 | 设置与卡片这条链**读实现**核对：`installSection` 签名与 hooks、namespace 文法、schema 必须可被浏览器重建、卡片按 namespace 派发、`dsh.client` 的解析与 bundle 缺失时的失败方式、客户端 scope 的 `bind`/`mutate` 形状；另确认本机挂载了 `dsh-settings-file` 且 `$DSH_HOME/settings.yaml` 可写 |
| 2026-09-20 | Desktop 2.0.13 / dsh 0.1.5-rc.2 | 「安装时那条 peer 警告」定位：在 `~/.dsh/profiles/desktop` 上 `pnpm peers check --lockfile-only --json`，`missing` 全是 `@xxxyz/dsh-mcp-manager`、`dsh-approval-mode`、`dsh-context`、`dshmarket` 的缺项，本插件不在其中；补上四个 optional peer 后，在含本插件的 lockfile 上同一命令得到 `missing: {}`、退 0。默认 `~/.copilot` 条目只在**发现流程**上实测（本机解析到 `C:\Users\nevstop\.copilot`，读到 `copilot-instructions.md` 与四个技能、无告警） |

### 4.2 设置链：`npm run verify:settings`

`test/settings.test.js` 用替身钉住接线，但没有 `@deepseek-ai/schemastery` 就无法回答那个真正
致命的问题：host 注册的 schema，**浏览器能不能重建**？客户端是按 `new Schema(serialized)`
从 `toJSON()` 的信封重建的；重建失败时该 namespace 拿不到任何可编辑值，而且**一声不吭**。

`scripts/verify-settings-schema.mjs` 就是拿真实的 schemastery 把这条链走一遍：解析组合配置
（默认值、用户层）、拒绝卡片不该接受的写入、`toJSON()` 序列化、再从信封重建并校验，
最后比对两半硬编码的 namespace 是否是同一个字符串。它在找不到 schemastery 时**跳过并退 0**
（所以不进 `npm run check`），找得到就**认真失败**：

```sh
npm run verify:settings
# 或指定一个具体的 schemastery：
node scripts/verify-settings-schema.mjs --schemastery <specifier-or-path>
```

2026-09-21 在本机 DSH Desktop 2.0.11 上 9/9 通过。

### 4.3 还没实测的部分（做完请划掉）

这些是本轮**没有**在运行中的 DSH 里跑过的，代码按实现写，但没到「看见它工作」的程度：

- [ ] 卡片真的出现在 **设置 → 插件 → 插件配置** 里（要重装插件 + 重启 DSH，见 §2.3）。
- [ ] 展开后的卡片样式与同页其他插件的卡片一致（本轮按宿主的 `PluginCard` 样式表逐类对齐，
      但没在真实 GUI 里比对过）。
- [ ] 「浏览…」在 DSH Desktop 窗口里弹出 Windows 选择框并填回该行；两条路由都不可用的部署
      （如远程浏览器访问的 `browse` 组合）显示提示而不是无反应。
- [ ] 保存后 `$DSH_HOME/settings.yaml` 里出现 `import-vscode-ai-files:` 小节，
      且下一个模型步骤开始生效。
- [ ] 默认的 `~/.copilot` 条目在真实会话里注入（要重装插件 + 重启 DSH；本轮只在发现流程上验证）。
- [ ] 「恢复默认」清掉用户覆盖、值回到组合配置（「放弃」只丢弃草稿）。
- [ ] `ctx.settings.installSection` 在 provider 卸载/重挂时的行为（`register` 对重复
      namespace 会抛错，上游没有文档说明它是否在两者之间 dispose）。

§2.3 的手工流程覆盖前五条；最后一条只有升级 DSH 或改动设置这条链时才需要重新确认。
`npm run verify:settings`（§4.2）已经覆盖了「浏览器能不能重建 schema」这条 —— 它此前也在
这份清单里，现在有命令可跑，就不再是「未实测」。

### 4.4 「安装时的 peer 警告」怎么自查

`dsh plugin add` 原样转发 pnpm 的输出，而 pnpm 的 peer 问题清单是**整个 profile** 的，
不是某个包的，所以任何一个插件漏声明 peer 都会让所有安装都带上这条警告：

```sh
cd $DSH_HOME/profiles/<profile>
pnpm peers check            # 加 --lockfile-only --json 只看 lockfile、机器可读
```

它按「缺的 peer → 谁缺的 → 要什么范围」逐条列出来。想确认**本插件**不贡献任何一条，
就在一个只依赖本插件（`"dsh-import-vscode-ai-files": "file:<repo>"`）的临时工程里跑同一条命令，
应为 `missing: {}` 且退 0 —— 它声明的四个 peer 全是 optional，optional 的缺项不进这份清单。

## 5. 打包与发版

```sh
npm run pack        # → dist/dsh-import-vscode-ai-files-<version>.tgz
```

发版：先在 `CHANGELOG.md` 写 `## [<version>]` 小节，把 `package.json` 的 `version` 对齐，
再打 tag 推送 `v<version>`。`.github/workflows/release.yml` 会校验两者一致、跑
`npm run check`、打包、用 `scripts/release-notes.mjs` 从 CHANGELOG 组装 Release 正文并附上
tarball。

## 6. 开发坑

- **注入顺序不能改回 splice**。`agent/pre-step` 是 waterfall，而所有注入监听器都插在
  **同一个位置**（已领取消息之后），所以**谁最后跑谁占前面**。本行在 host 平面、先于
  preset 挂载注册，用 splice 会把 `.github` 规则排到 AGENTS.md **前面**。
  现在改成**追加到末尾**，顺序与注册顺序无关。
- **profile patch 层不热重载**。装完/改完 `cordis.patch.yml` 要重启 DSH。实测：往 patch
  插入一行 `@deepseek-ai/dsh-tool-str-replace-editor` 后，全局工具注册表里始终没有它。
  仓库里的 `.github/**` 不受此限（每个模型步骤重新读盘）。
- **host 平面而不是 preset 平面**。`@deepseek-ai/dsh-tool-cordis` 无条件
  `ctx.cordisInspect.register(provider)` 注册**进程级** Host Inspect provider，没有 realm
  隔离，于是两个含它的 preset 无法在同一进程共存。实测：把同一份 composition 里唯一一行
  `tool-cordis` 禁用后 `standingKeyFor` 立即 `mounted OK`，不禁用则报
  `inspect provider "Service" is already registered`。
- **目录失效不能绑在会话 cwd 上，也不能只认 `.github`**。provider 是全局的、一个实例服务所有
  工作区，所以任何配置变更都要让它失效，而不只是当前会话 cwd 下的；而且 `paths` 条目**自己**
  就是配置目录，路径里没有 `.github` 段 —— 只匹配 `/.github/` 会让共享目录里改技能永远不刷新。
  `touchesConfigDir` 两种形状都认（`index.js`），`test/index.test.js` 各钉一条。
- **`paths` 条目是配置目录，不是项目根**。`instructionDirs` / `skillDirs` 在它上面会去掉前导的
  `.` 段与 `.github` 段（win32 上 `\` 与 `/` 都接受，`custom/rules` 这类自定义目录原样拼接），
  `scanSubdirectories` 不作用于它，它的子目录是内容而不是更多的配置目录；它内部的 `.github`
  树一律不被读取 —— 连 `'.'`、`'./.github'`、`'x/.github/y'`、`''`、`'/'` 这些退化写法也不行
  （fixture 里就放着这样一棵树当负例）。改 `lib/discover.js` 的扫描模型时，cwd 侧与 `paths` 侧
  只在 `rootDir`（`applyTo` 的锚点）上分叉，别让两边的 `.github` 语义漂移；另外两个单位可能
  解析到同一个源文件（`paths` 点名一个已在走查里的目录 + 自定义目录名），发现结果按绝对路径
  去重，别把同一个文件注入两次。
- **`paths` 的默认条目是 `~/.copilot`**（`DEFAULT_PATHS`，`cordis.patch.yml` 与设置 schema 同源）。
  它让每个会话默认带上用户级 Copilot 配置，也让**测试必须自带 home**：`apply` 的
  `options.homeDir` 与 `discover` 的 `homeDir` 是同一个 seam，`test/index.test.js` 的 `mount`
  默认指到一个**不存在**的目录，用例要测默认条目时才指到自己的临时 home。谁把 `discover()`
  的 home 换回 `os.homedir()`，用例就会在「开发机上恰好有 `~/.copilot`」时红、在 CI 上绿。
  显式 `paths: []` 是关闭它、不是缺省，`normalizeSettings` 认这个区别。
- **配置路径只解析一次，且只在 `lib/discover.js`**：`resolveConfiguredPath(cwd, value, home)`
  是唯一的入口（`~` 展开、cwd 相对、cwd 为 `null` 时拒绝相对条目都在它里面），
  `index.js` 的 `touchesConfigDir` 复用它。别在别处再写一份 `resolve()`，
  否则「发现读到的目录」与「改动会让技能目录失效的目录」会漂移。
  只有**开头**的 `~` 是主目录（`~name`、`a/~/b` 是普通相对路径），通配符与环境变量不展开。
- **`disable-model-invocation: true` 会让技能不进目录**。这是既定语义，不是插件 bug；
  想让模型看到就不要写这一行（或写 `false`）。
- **卡片的 slot key 必须等于设置命名空间**。`settings.plugin.item` 是按 namespace 派发的：
  key 写错不会报错，卡片只是永远不出现。host 侧的 `SETTINGS_NAMESPACE`（`index.js`）与
  browser 侧的 `NAMESPACE`（`lib/client.js`）是同一个字符串的两份硬编码，改一个必须改另一个。
- **「浏览…」不能只走一条路由**。win32 的 DSH Desktop profile 禁用了
  `dsh-host-directory-picker-auto`，改挂 `browse` 后端，而 `browse` 没有 `pick` 能力：
  `uiWorkspace.pickDirectory()` 在那里**必然被拒**（`directory-picker/unavailable`）。
  可用的两条路由是 `window.__DSH_DESKTOP_PICK_DIRECTORY__`（Desktop / win32）与
  `uiWorkspace.pickDirectory()`（挂 `native` 后端的组合），两条都在时以前者为准 ——
  否则一次「浏览」会弹两次框。两条都不在时卡片给提示让人手填，**不吞掉 rejection**：
  `void browse().then(...)` 那种写法在按钮上表现为「点了没反应」。
- **设置 schema 不能自己写一个「形状像」的对象**。服务本身不检查 schema 的形状，所以手写的
  能通过 host；但浏览器要靠 `schema.toJSON()` 的 `{ uid, refs }` 信封把它重建出来渲染表单，
  重建失败时该 namespace **没有可编辑值**（`decode` 返回 undefined，卡片只能渲染空态），
  而且没有任何报错。这就是 `@deepseek-ai/schemastery` 必须以真身出现的原因。
- **`dsh.client` 声明了就必须有 bundle**。宿主扫描已启用的 Loader 条目并解析
  `exports['./client']`；文件缺失会让客户端激活**大声失败**（不是静默降级）。
  改 `package.json` 的 `exports` 时注意别把 `./client` 弄丢。
- **设置写入是带 revision 的**。卡片提交时带草稿开始那一刻的 revision，被并发改动抢先会被
  拒绝 —— 这是设计（`expectedRevision`），不是失败重试的重试。改卡片时不要图省事改成
  「不带 revision 的 `set`」，那会静默覆盖别人的改动。
- **Windows 上 git push 可能需要 TLS 兜底**。schannel 在某些环境取不到凭证
  （`SEC_E_NO_CREDENTIALS`，`curl.exe` 同样失败），换 OpenSSL 后端 + 从系统证书库导出的
  CA 即可：`git -c http.sslBackend=openssl -c http.sslCAInfo=<ca.pem> push`。
  实测细节（2026-09-19，本机）：
  - **症状**：`fatal: unable to access 'https://github.com/…': schannel: AcquireCredentialsHandle
    failed: SEC_E_NO_CREDENTIALS (0x8009030E)`。
  - **原因**：本机 TLS 被本地工具箱**中间人**（presented chain 的 issuer 是 `SteamTools
    Certificate`）。该根证书装在 Windows 证书store 里，所以浏览器、`gh`、Go 程序都正常，
    只有走 schannel 的 git 不行。
  - **怎么看出来**：`openssl s_client` 在受限沙箱里**跑不起来**（Cygwin 进程起不来 signal
    pipe，`Win32 error 5`，只有一坨 stack trace），改用 node 探针（注意 `s` 要先绑定，
    回调里才拿得到 `s`，否则是回调内抛 `ReferenceError`，外面 try/catch 也拦不住）：
    ```js
    import tls from 'node:tls'
    const s = tls.connect(
      { host: 'github.com', port: 443, servername: 'github.com', rejectUnauthorized: false },
      () => { console.log(s.getPeerCertificate(true).issuer) },
    )
    ```
  - **修**：把**拦截方**的根证书导成 PEM 再换后端。用 `-c http.sslCAInfo=<Git 自带
    ca-bundle.crt>` 会得到 `SSL certificate problem: unable to get local issuer certificate`
    —— 那是 CA 选错了，不是网络不通。导出（`Subject` 换成上面看到的 issuer）：
    ```powershell
    $pem = (Get-ChildItem Cert:\CurrentUser\Root, Cert:\LocalMachine\Root |
      Where-Object { $_.Subject -like '*SteamTools*' } | ForEach-Object {
        $b = $_.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
        "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($b, 'InsertLineBreaks') + "`n-----END CERTIFICATE-----"
      }) -join "`n"
    [System.IO.File]::WriteAllText("$env:TEMP\intercept-ca.pem", $pem)
    ```
    然后：`git -c http.sslBackend=openssl -c http.sslCAInfo="$env:TEMP\intercept-ca.pem" push`。
    **别把它写进 `git config`，也别写进仓库里的任何文件** —— CA 路径是本机的，换机器就失效。
- **沙箱里 gh 的 credential helper 起不来**。全局配置里有
  `credential.https://github.com.helper=!'C:\Program Files\GitHub CLI\gh.exe' auth git-credential`，
  受限沙箱下它会以 `error: failed to execute prompt script (exit code 66)` +
  `fatal: could not read Username for 'https://github.com'` 结束 —— 看起来像认证失败，其实是
  那个子进程没起来。绕过：**关掉 helper**，用 `gh auth token` 直接给一次性的授权头
  ```powershell
  $pair = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$(gh auth token)"))
  git -c credential.helper= -c http.extraheader="Authorization: Basic $pair" push
  ```
  token 不要落盘、不要打印；`-c` 只作用于当次命令，不会写进 config。注意 **`$pair` 本身就是
  一份可用凭证**，它会出现在进程命令行里（同用户的进程用 `Win32_Process.CommandLine` 就能看到），
  所以别把它贴进日志、CI 输出或 issue 里。
- **推送被 `GH007` 拒绝＝提交作者邮箱是私密邮箱**。
  `remote: error: GH007: Your push would publish a private email address.` —— 本机全局
  `user.email` 是一个私密地址，而仓库开了 “block command line pushes that expose my email”。
  本仓库历史用的是 noreply 地址，照抄它：
  ```powershell
  git log -3 --format='%an <%ae>'                 # 先看历史用的是哪一种
  git -c user.name=NEVSTOP -c user.email=8196752+nevstop@users.noreply.github.com \
      commit --amend --no-edit --reset-author      # ID 从 gh api user --jq .id 取
  ```
  `--amend` 只重写**顶端**那一个提交；分支上不止一个提交带私密邮箱时它不够，要么
  `git rebase --exec 'git commit --amend --no-edit --reset-author' <base>` 逐个重写，
  要么先在 `git config user.email` 里改成 noreply 再重写整条分支。
  已经推上去过再加这些改写，需要 `--force-with-lease` 重推。

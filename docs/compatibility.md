# 兼容性与验证

## 1. 依赖面

### 1.1 加载期零依赖

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
所以 `lib/frontmatter.js` 与 `lib/glob.js` 只能自己写。

唯一的例外是 `@deepseek-ai/schemastery`（设置 schema 必须是真的 schemastery），
它由 DSH 的包带进 profile 共享的 `node_modules`，实测可解析：以**装好的**插件路径为基准
`createRequire('…/profiles/<p>/node_modules/dsh-import-copilot-files/index.js').resolve('@deepseek-ai/schemastery')`
解析到 Desktop 自带的那份副本。即便如此也只用**惰性动态 import**：`index.js` 里只有
`import('@deepseek-ai/schemastery')` 一处，且只在 `settings` 服务存在时才执行。所以 clone
下来没有 `node_modules` 也能 `npm run check`；反过来，某个 profile 真的解析不到它时，丢的是
设置卡片，不是整个插件（`attachSettings` 的 catch 会打一条 `console.error`）。

`lib/settings.js` 因此不 import 任何东西：`z` 由调用方传入，所以 schema 的形状能离线测试。

### 1.2 对 DSH 的依赖是 6 个接缝 + 3 处内部契约

| 用途 | 接缝 |
| --- | --- |
| 注入 instructions | `ctx.on('agent/pre-step', …)` |
| 注册 skills | `ctx.skills.registerProvider(create)` |
| 已触及文件 + 目录失效 | `ctx.on('fs/observed', …)` |
| 设置命名空间（可选服务） | `ctx.inject(['settings'], …)` → `settings.installSection(…)` |
| 设置卡片（browser half） | `ctx.settingsScope.bind({ namespace })`、`ctx.slots.register({ name: 'settings.plugin.item', key })`、`ctx.locale.register` |
| 卡片的「浏览…」（browser half） | `ctx.get('uiWorkspace').pickDirectory()`，或 DSH Desktop 在 win32 页面上装的 `window.__DSH_DESKTOP_PICK_DIRECTORY__` |

接缝之外还有三处**内部契约**：

1. 注入消息的四个字段（详见 [design.md §3.2](./design.md)）；
2. pre-step decision 的形状；
3. `settings.plugin.item` 的 slot key **就是设置命名空间**（[design.md §3.8](./design.md)）。

前两处整个包在 try/catch 里 —— 形状变了只记一条 `console.error` 并跳过注入，不会弄坏整个
turn。第三处没有 try/catch 可包：key 与 namespace 不一致时卡片**安静地不渲染**，所以两半
各自被测试钉住（`test/settings.test.js` / `test/client.test.js`），并由
`npm run verify:settings` 直接比对两个字符串。

### 1.3 版本要求

加载期不 import 任何 DSH 包，所以兼容性由 §1.2 的清单决定；`peerDependencies` 里的范围只是
契约记录（全 optional，不会被安装，也不会拦安装）。
**接缝实测环境：DSH Desktop 2.0.11 / dsh `0.1.5-rc.2`**（与 `dsh-approval-mode` 相同）；
本机 2026-09-20 起装的是 Desktop 2.0.13，§3 的记录逐条写明各自跑在哪个版本上。

## 2. 升级 DSH 之后按顺序查

1. `dsh --profile <profile> --dump-config` 里还有没有 `dsh-import-copilot-files` 行。
2. 六个接缝还在不在 —— 用 `cordis_inspect_query` 查 `Event.listEvents` 与
   `Service.listService`（`settings`、`skills`），以及客户端的 `Slots.listSubTree`
   （`settings.plugin.item` / `settings.plugins.tab` 是否仍由「插件配置」标签页声明）。
3. 注入消息的四个字段（`id` / `role` / `content` / `source`）与 pre-step decision 的形状
   （`await next()` 之后返回 `{ …decision, messages }`）—— 对照
   `@deepseek-ai/dsh-llm/lib/types/message.js` 的 `createUserMessage`。
4. 注入行的渲染：`dsh-client-ui-chat` / `dsh-client-ui-trajectory` 的 `contextProvenance`
   决定行标题（`role: 'recall'` 为「上下文召回」，其余为「上下文注入」）与来源标签
   （`source.plugin`），`KNOWN_FORMS` + `contextBody(form)` 决定正文形态。
5. `agent.session.header.cwd` 或 `actor.agent` 还在不在。
6. 设置这条链：`dsh-settings` 的 `installSection` 签名与 `hooks`（`setSource` / `onChange`）、
   `dsh-client-ui-settings` 的 `bind(spec)` 与 scope 方法、`dsh-client-modules` 对
   `dsh.client`（`platform` / `exports['./client']`）的解析规则。这三处是本插件唯一
   「跟着上游内部形状走」的地方。
7. 卡片的目录选择：`uiWorkspace.pickDirectory()` 还在不在，以及 win32 的 DSH Desktop
   profile 是否仍然禁用 `dsh-host-directory-picker-auto`（改挂 `browse` 后端时
   `pick` 会被 Remote 拒绝），`window.__DSH_DESKTOP_PICK_DIRECTORY__` 是否仍被安装。
8. 先跑 `npm run check` 排除自己的逻辑回归。

## 3. 验证记录

### 3.1 接缝实测（2026-09-18，Desktop 2.0.11 / dsh 0.1.5-rc.2）

| 接缝 | 结论 |
| --- | --- |
| `agent/pre-step` | 注入的 `form: 'instructions'` 消息确实到达模型，GUI 显示为独立一行，来源标签取自 `source.plugin`（行标题由客户端固定为「上下文注入」，2026-09-20 在 Desktop 2.0.13 上复核） |
| `skills.registerProvider` | `list({ cwd })` 收到真实 cwd；`get()` 返回正文与 `resourceBase`；`invocation` 策略与 frontmatter 一致 |
| `fs/observed` | `actor` 是 `ToolExecution`，携带 `.agent`（`id` 与 `session.header.cwd`），可按会话分桶 |

另记两条否证，它们塑造了当前形态：

- `ctx.systemPrompt.context` 的正文会被折叠进 `dsh-system-prompt` 那一行（`form: 'snapshot'`）
  —— 内容送达没问题，但来源标签不属于本插件，用户扫过去会认为"没有注入"。
- `dsh-tool-cordis` 的进程级 Inspect provider 排除了 preset 平面（[design.md §2.1](./design.md)）。
- `dsh-tool-cordis` 的进程级 Inspect provider 排除了 preset 平面（[design.md §2.1](./design.md)）。

### 3.2 端到端

在一个真实工作区验证了 5 份指令文件的注入、`applyTo` 的负例（未命中不注入）、
正文改动下一步生效、`Instructions removed:`、技能进目录、以及 `/name` 调用。

### 3.3 离线

`npm run check`：9 个文件的 `node --check` + 126 项 `node:test`（glob 9 / frontmatter 9 /
discover 37 / 插件 43 / 设置 10 / 客户端 bundle 18）。
`test/index.test.js` 对着假 Cordis 上下文驱动真实插件对象，覆盖注入顺序、跨会话隔离、
预算边界、`applyTo` 正反例、移除通知、`paths`、默认的 `~/.copilot` 条目（含关掉它），
以及**设置服务 → 发现流程**这条端到端链路（含 schema 装载失败时回落到组合配置）；
`test/discover.test.js` 另外钉住配置目录语义的负例（条目内部的 `.github` 树一律不读、它的
子目录不是配置目录、AGENTS.md 从不被读、两个单位落到同一个源文件时只出现一次、退化目录取值
与 Windows 写法都不越界），以及 `~` 的落点与「只有开头的 `~` 才算主目录」；用例通过 `apply`
的 `options.homeDir` / `discover` 的 `homeDir` 把 home 指到一个临时目录（`mount` 默认指到
不存在的目录），所以断言不依赖跑测试的机器；`test/settings.test.js` 用注入的 schema loader
钉住命名空间接线（含 loader 失败与 dispose 的降级路径）与默认值；`test/client.test.js` 按
客户端模块系统的方式**跑真实 bundle**（假 `__ModuleLoader__` + React 替身），覆盖卡片注册与
标题、折叠/展开、暂存/保存（含 revision 与回读确认）、只读态、恢复默认、两条目录选择路由与
选择失败时的提示、样式安装/卸载。

### 3.4 设置与卡片的依据（2026-09-21，Desktop 2.0.11 / dsh 0.1.5-rc.2）

本节的结论来自**读实现**（`resources/app/node_modules/@deepseek-ai/*` 的 `lib/*.js` 与
README）加上一段**可重跑的脚本**（[development.md §3](./development.md)），不是运行中的 GUI
实测 —— 卡片要在 DSH 重启并重装插件后才会出现，本轮没有做那一步。未实测的部分在 §4 列出。

`npm run verify:settings` 拿真实的 schemastery 把 schema 这条链跑通 9/9：解析组合配置与用户层、
拒绝非法写入、`toJSON()` 信封、**从信封重建并校验**（浏览器渲染卡片走的就是这一步），以及两半
的 namespace 是同一个字符串。

| 契约 | 依据 |
| --- | --- |
| 设置服务在 Desktop 里存在且可写 | 组合层挂载 `@deepseek-ai/dsh-settings-file`（`dsh-base/cordis.patch.yml`），默认落点 `$DSH_HOME/settings.yaml` 已存在且有 6 个 namespace 小节；provider `writable` 为 true |
| `installSection(owner, ns, schema, entry, hooks)` | `dsh-settings/lib/index.js`；`setSource` 先给 `() => scope.get()`，服务消失时给 `() => entry` |
| namespace 文法 | `/^[a-z][a-z0-9-]*$/`，`import-copilot-files` 合法（`verify:settings` 复核） |
| schema 必须是真 schemastery | 浏览器用 `new Schema(serialized)` 重建 `{ uid, refs }` 信封（`dsh-client-ui-settings/lib/client.js`）；重建失败则该 namespace 没有可编辑值。`verify:settings` 用真实 schemastery 走通重建 |
| 卡片按 namespace 派发 | `settings.plugin.item` 由「插件配置」标签页按 `entryKey = ns` 派发（`dsh-client-ui-settings-plugins/lib/client.js`） |
| bundle 格式与发现 | `dsh.client`（`platform: 'web'`）+ `exports['./client']`；宿主扫描**已启用的 Loader 条目**，缺失 bundle 会大声失败（`dsh-client-modules`） |
| 客户端 scope API | `bind({namespace})` → `getSnapshot/subscribe/set/unset/mutate(ops, expectedRevision)`（`dsh-client-ui-settings/lib/client.js`） |
| 目录选择器的两条路由 | win32 的 DSH Desktop profile 禁用 `dsh-host-directory-picker-auto`、改挂 `browse` 后端（`resources/app/lib/profile-*.js`）；`browse` 没有 `pick`，Remote 控制器按 `requireCapability('native','pick')` 答 `directory-picker/unavailable`（`dsh-api-workspace-controller/lib/types/directory-picker.js`）；`window.__DSH_DESKTOP_PICK_DIRECTORY__` 只在 win32 页面安装（`resources/app/lib/client.js`） |
| 手写 bundle 可行 | 第三方插件 `dsh-git-rollback` 的 `lib/client.js` 就是同一格式，且已在用 |

### 3.5 依赖与版本核对

| 日期 | DSH | 结论 |
| --- | --- | --- |
| 2026-09-18 | Desktop 2.0.11 / dsh 0.1.5-rc.2 | 三个接缝与两处内部契约逐条实测通过；端到端验证见 §3.2 |
| 2026-09-21 | Desktop 2.0.11 / dsh 0.1.5-rc.2 | 设置与卡片这条链**读实现**核对：`installSection` 签名与 hooks、namespace 文法、schema 必须可被浏览器重建、卡片按 namespace 派发、`dsh.client` 的解析与 bundle 缺失时的失败方式、客户端 scope 的 `bind`/`mutate` 形状；另确认本机挂载了 `dsh-settings-file` 且 `$DSH_HOME/settings.yaml` 可写 |
| 2026-09-20 | Desktop 2.0.13 / dsh 0.1.5-rc.2 | 「安装时那条 peer 警告」定位：在 `~/.dsh/profiles/desktop` 上 `pnpm peers check --lockfile-only --json`，`missing` 全是 `@xxxyz/dsh-mcp-manager`、`dsh-approval-mode`、`dsh-context`、`dshmarket` 的缺项，本插件不在其中；补上四个 optional peer 后，在含本插件的 lockfile 上同一命令得到 `missing: {}`、退 0。默认 `~/.copilot` 条目只在**发现流程**上实测（本机解析到 `C:\Users\nevstop\.copilot`，读到 `copilot-instructions.md` 与四个技能、无告警） |

## 4. 还没实测的部分（做完请划掉）

这些是在运行中的 DSH 里**没有**跑过的，代码按实现写，但没到「看见它工作」的程度：

- [ ] 卡片真的出现在 **设置 → 插件 → 插件配置** 里（要重装插件 + 重启 DSH，见 [development.md §2.3](./development.md)）。
- [ ] 展开后的卡片样式与同页其他插件的卡片一致（按宿主的 `PluginCard` 样式表逐类对齐，
      但没在真实 GUI 里比对过）。
- [ ] 「浏览…」在 DSH Desktop 窗口里弹出 Windows 选择框并填回该行；两条路由都不存在的部署
      不渲染该按钮（手填路径），路由存在但拒绝选择时显示提示而不是无反应。
- [ ] 保存后 `$DSH_HOME/settings.yaml` 里出现 `import-copilot-files:` 小节，
      且下一个模型步骤开始生效。
- [ ] 默认的 `~/.copilot` 条目在真实会话里注入（要重装插件 + 重启 DSH；只在发现流程上验证过）。
- [ ] 「恢复默认」清掉用户覆盖、值回到组合配置（「放弃」只丢弃草稿）。
- [ ] `ctx.settings.installSection` 在 provider 卸载/重挂时的行为（`register` 对重复
      namespace 会抛错，上游没有文档说明它是否在两者之间 dispose）。

[development.md §2.3](./development.md) 的手工流程覆盖前五条；最后一条只有升级 DSH 或改动设置
这条链时才需要重新确认。`npm run verify:settings` 已经覆盖了「浏览器能不能重建 schema」这条。

## 5. 「安装时的 peer 警告」怎么自查

`dsh plugin add` 原样转发 pnpm 的输出，而 pnpm 的 peer 问题清单是**整个 profile** 的，
不是某个包的，所以任何一个插件漏声明 peer 都会让所有安装都带上这条警告：

```sh
cd $DSH_HOME/profiles/<profile>
pnpm peers check            # 加 --lockfile-only --json 只看 lockfile、机器可读
```

它按「缺的 peer → 谁缺的 → 要什么范围」逐条列出来。缺的那几条属于那些包自己，装上对应版本
或等它们补齐即可 —— 与本插件无关，也不影响本插件运行。想确认**本插件**不贡献任何一条，
就在一个只依赖本插件（`"dsh-import-copilot-files": "file:<repo>"`）的临时工程里跑同一条命令，
应为 `missing: {}` 且退 0 —— 它声明的四个 peer 全是 optional，optional 的缺项不进这份清单。

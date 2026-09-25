# 兼容性与验证

## 1. 依赖面

### 1.1 加载期零依赖

`dependencies` 为空，**静态** import 只有 `node:crypto`、`node:fs`、`node:module`、`node:os`、
`node:path`。`peerDependencies` 列出宿主契约 —— `@deepseek-ai/cordis`、`@deepseek-ai/dsh-settings`、
`@deepseek-ai/schemastery`、`react` —— 并且**四个全部是 optional**（`peerDependenciesMeta`）：
这个插件在 profile 里本来就能缺其中任何一个（见 §1.2 的两处可选），而 optional 的 peer 不会进
pnpm 的 peer 问题清单，所以这条声明不制造新警告。声明的作用是让 manifest 如实描述「跑起来需要
什么」，也让 `resolveModuleFallbackEntries` 这类按 `dependencies` + `peerDependencies` 走的解析器
认得它。

`peerDependencies` 不是 `dependencies` 的替代品：它**不会被安装**，插件仍然不能假定
`@deepseek-ai/*` 一定解析得到。插件的宿主半侧跑在 harness 进程里，但模块解析走的是
**profile 的 `node_modules`**，而那条路径是部署给的、不保证有什么 —— 所以 `lib/frontmatter.js`
与 `lib/glob.js` 只能自己写。

唯一的例外是 `@deepseek-ai/schemastery`（设置 schema 必须是真正的 schemastery），它由 DSH 的包
带进 profile 共享的 `node_modules`，实测可解析：以**装好的**插件路径为基准
`createRequire('…/profiles/<p>/node_modules/dsh-import-copilot-files/index.js').resolve('@deepseek-ai/schemastery')`
解析到 Desktop 自带的那份副本。即便如此也**不在模块顶层 import**：`index.js` 里只有一处
`createRequire(import.meta.url)('@deepseek-ai/schemastery')`，位于 `Config` getter 的
taker 里，`try` 包住、结果（含失败）记忆化。所以 clone 下来没有 `node_modules` 也能
`npm run check`；反过来，某个 profile 真的解析不到它时，丢的是设置页（`Config` 变成
`undefined`，该条目没有表单、卡片也不注册），不是整个插件。

`lib/settings.js` 因此不 import 任何东西：`z` 由调用方传入，所以 schema 的形状能离线测试。

### 1.2 对 DSH 的依赖是 5 个接缝 + 3 处内部契约

| 用途 | 接缝 |
| --- | --- |
| 注入 instructions | `ctx.on('agent/pre-step', …)` |
| 注册 skills | `ctx.skills.registerProvider(create)` |
| 已触及文件 + 目录失效 | `ctx.on('fs/observed', …)` |
| 设置文档 / 设置表单 | 导出的 `Config`（schemastery schema），字段 `.volatile()` |
| 设置提交后让技能目录失效 | `ctx.on('loader/volatile-update', …)`（只在**本条目自己的 fiber** 上触发） |
| 设置页（browser half） | `ctx.configForms.get(entryId)`、`ctx.configForms.whileServed([entryId], …)`、`ctx.slots.register({ name: 'plugins.item', id: entryId })`、`ctx.locale.register` |
| 设置页的「浏览…」（browser half） | `ctx.get('uiWorkspace').pickDirectory()`，或 DSH Desktop 在 win32 页面上装的 `window.__DSH_DESKTOP_PICK_DIRECTORY__` |

接缝之外还有三处**内部契约**：

1. 注入消息的四个字段（详见 [design.md §3.2](./design.md)）；
2. pre-step decision 的形状；
3. 设置文档按 **Loader 条目 id** 寻址：`dsh-settings` 把插件的 `Config` 当成该条目的设置文档，
   浏览器卡片用同一个 id 取表单（`configForms.get(entryId)`）并作为
   `plugins.item` 的 cell id 注册（[design.md §3.8](./design.md)）。

前两处整个包在 try/catch 里 —— 形状变了只记一条 `console.error` 并跳过注入，不会弄坏整个
turn。第三处没有 try/catch 可包：id 不一致时卡片**安静地不渲染**，所以三个文件
（`index.js` 的 `SETTINGS_ENTRY_ID`、`lib/client.js` 的 `ENTRY_ID`、`cordis.patch.yml` 的
`insert[].id`）由 `npm run verify:settings` 直接比对。

### 1.3 版本要求

加载期不 import 任何 DSH 包，所以兼容性由 §1.2 的清单决定；`peerDependencies` 里的范围只是
契约记录（全 optional，不会被安装，也不会拦安装）。

**设置这条链的形态是 dsh `0.1.7` 才改成的**，本插件从该版本起按新形态实现，**不再兼容
`0.1.5`/`0.1.6`**：那些版本用的是「注册设置命名空间」（`ctx.settings.installSection` +
`ctx.settingsScope.bind({ namespace })` + `settings.plugin.item`），三处都已在 `0.1.7` 移除或改名。
`peerDependencies` 里 `@deepseek-ai/dsh-settings` 的范围因此写成 `>=0.1.7-rc.1 <0.2.0`
（`^0.1.1-rc.2` 这类写法按 semver 的预发布规则**匹配不到** `0.1.7-rc.1`，会让 pnpm 报一条
invalid peer）。

实测环境：**DSH Desktop 2.0.14 / dsh `0.1.7-rc.1`**（§3.5）。旧记录（Desktop 2.0.11/2.0.13 /
dsh `0.1.5-rc.2`）保留在 §3.1–§3.5 里，因为那三个 host 接缝到 `0.1.7` 一字未改。

## 2. 升级 DSH 之后按顺序查

1. `dsh --profile <profile> --dump-config` 里还有没有 `dsh-import-copilot-files` 行。
2. 五个接缝还在不在 —— 用 `cordis_inspect_query` 查 `Event.listEvents` 与
   `Service.listService`（`settings`、`skills`），以及**客户端的** `Slots.listSubTree`
   （`plugins.item` 是否仍由「插件」页声明、`configForms` 是否仍由 `ui-settings` 提供）。
3. **静态 `inject` 列表里的每一个名字都必须真的有人提供。** 这是本项目踩过的坑（§3.6）：
   `inject` 里放一个不存在的服务名不会报错，插件 fiber 会**永远停在 pending**，而客户端启动
   报告把它算作「插件加载失败」，Desktop 于是进恢复界面/安全模式。可选服务只能放在
   **嵌套的 `ctx.inject([...], cb)`** 里，或干脆用 `ctx.get(name)`。
4. 注入消息的四个字段（`id` / `role` / `content` / `source`）与 pre-step decision 的形状
   （`await next()` 之后返回 `{ …decision, messages }`）—— 对照
   `@deepseek-ai/dsh-llm/lib/types/message.js` 的 `createUserMessage`。
5. 注入行的渲染：`dsh-client-ui-chat` 的 `ContextInjectionRow` 用 `contextProvenance` 固定行标题
   （`role: 'recall'` 为「跨会话召回」，其余为「上下文注入」）与来源标签（`source.plugin`），
   `source.form` 经 `contextBody(form)` 决定正文形态，合法值取自 `KNOWN_FORMS`；
   `dsh-client-ui-trajectory` 另有自己的 `contextProvenance` / `KNOWN_FORMS`，上下文条目按
   `kind.context` 标成「上下文」。
6. `agent.session.header.cwd` 或 `actor.agent` 还在不在。
7. 设置这条链：`dsh-settings` 的 `describe()` / `update()` / `volatileForm` / `isVolatilePath`、
   `dsh-client-ui-settings` 的 `ConfigForms.get` / `whileServed` 与 `ConfigFormController` 的
   scope 方法（`getSnapshot` / `subscribe` / `mutate(ops, revision)` / `unset(field)`）、
   `dsh-client-ui-plugin-manager` 的 `plugins.item` 契约（`view` 与 `id`）、以及
   `dsh-client-modules` 对 `dsh.client`（`platform` / `exports['./client']`）的解析规则。
   这几处是本插件唯一「跟着上游内部形状走」的地方；`npm run verify:settings` 逐条覆盖。
8. 卡片的目录选择：`uiWorkspace.pickDirectory()` 还在不在，以及 win32 的 DSH Desktop
   profile 是否仍然禁用 `dsh-host-directory-picker-auto`（改挂 `browse` 后端时
   `pick` 会被 Remote 拒绝）、`window.__DSH_DESKTOP_PICK_DIRECTORY__` 是否仍被安装。
9. 先跑 `npm run check` 排除自己的逻辑回归。

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

### 3.2 端到端

在一个真实工作区验证了 5 份指令文件的注入、`applyTo` 的负例（未命中不注入）、
正文改动下一步生效、`Instructions removed:`、技能进目录、以及 `/name` 调用。

### 3.3 离线

`npm run check`：9 个文件的 `node --check` + 126 项 `node:test`（glob 9 / frontmatter 9 /
discover 37 / 插件 43 / 设置 9 / 客户端 bundle 19）。
`test/index.test.js` 对着假 Cordis 上下文驱动真实插件对象，覆盖注入顺序、跨会话隔离、
预算边界、`applyTo` 正反例、移除通知、`paths`、默认的 `~/.copilot` 条目（含关掉它），
以及**volatile Config → 发现流程**这条端到端链路（含 schema 解析不到、配置是普通对象时的
回落）；`test/discover.test.js` 另外钉住配置目录语义的负例（条目内部的 `.github` 树一律不读、
它的子目录不是配置目录、AGENTS.md 从不被读、两个单位落到同一个源文件时只出现一次、退化目录取值
与 Windows 写法都不越界），以及 `~` 的落点与「只有开头的 `~` 才算主目录」；用例通过 `apply`
的 `options.homeDir` / `discover` 的 `homeDir` 把 home 指到一个临时目录（`mount` 默认指到
不存在的目录），所以断言不依赖跑测试的机器；`test/settings.test.js` 用注入的 schema 替身
钉住 `Config` 的形状（字段、默认值、**只有 `paths` 是 volatile**）与 `normalizeSettings`
读的是活引用；`test/client.test.js` 按客户端模块系统的方式**跑真实 bundle**（假
`__ModuleLoader__` + React 替身），覆盖页面注册（entry id、`plugins.item`、`view: 'summary'`
与 `'page'`）、暂存/保存（含 revision 与回读确认）、只读态、恢复默认、两条目录选择路由与
选择失败时的提示、样式安装/卸载，以及**「不得再出现 `settingsScope` / `settings.plugin.item`」
这条回归钉子**。

### 3.4 设置与页面（2026-09-25，Desktop 2.0.14 / dsh 0.1.7-rc.1）

`npm run verify:settings` 的 13 项检查**全部通过对真实上游实现**，不是对着替身：

| 检查 | 依据 |
| --- | --- |
| schema 解析组合配置与用户层、拒绝非法写入、默认值按次克隆 | 真实 `@deepseek-ai/schemastery`（`lib/index.mjs`） |
| `paths` 是唯一的 volatile 字段 | schema 自身；`dsh-settings` 的 `volatileForm` / `isVolatilePath` 只认 `meta.volatile` |
| `toJSON()` 的 `{ uid, refs }` 信封可由 `new Schema(serialized)` 重建并解析 | 浏览器 `ConfigFormController.decode` 走的就是这一步 |
| 真实 `SettingsForms.describe()` 只返回本条目、`value` 只含 `paths`、带数值 `revision` | `@deepseek-ai/dsh-settings/lib/index.js`（用原型实例 + 假 `configEditor` 驱动真实投影代码） |
| 真实 `SettingsForms.update(id, { paths })` 写出的行配置**保留** `maxBytes` / `scanSubdirectories` | 同上（真实 `write` → `validatePaths` → `strip` → `mergeLayers`） |
| `index.js` / `lib/client.js` / `cordis.patch.yml` 三处 id 相同 | 三个文件直接比对 |

运行中的客户端（Desktop 2.0.14）用 `cordis_inspect_query` 实测：

| 查询 | 结论 |
| --- | --- |
| `client` / `Slots.listSubTree` `plugins.item` | **存在**，`kind: list`，`ownerProps` 为 `{ view: 'summary' \| 'page', form? }`；已有 occupant `agent-loop` / `subagent` / `web-search` —— 后两者正是官方「每个 host 插件一页」的设置页 |
| `client` / `Slots.listSubTree` `settings.plugin.item` | **`available: false`** —— 该 slot 在 `0.1.7` 已不存在（旧卡片注册在这里） |
| `client` / `Service.listService` | `slots`、`locale`、`uiWorkspace` 存在；**没有** `settingsScope`（该服务在 `0.1.7` 改名为 `configForms`，由 `@deepseek-ai/dsh-client-ui-settings` 提供） |
| host / `Config.listConfigs` | `include:ui-settings`、`include:ui-plugin-manager` 均为 `schema`（已组合），所以 `configForms` 与 `plugins.item` 都有人提供 |

### 3.5 依赖与版本核对

| 日期 | DSH | 结论 |
| --- | --- | --- |
| 2026-09-18 | Desktop 2.0.11 / dsh 0.1.5-rc.2 | 三个 host 接缝与两处内部契约逐条实测通过；端到端验证见 §3.2 |
| 2026-09-20 | Desktop 2.0.13 / dsh 0.1.5-rc.2 | 「安装时那条 peer 警告」定位：在 `~/.dsh/profiles/desktop` 上 `pnpm peers check --lockfile-only --json`，`missing` 全是 `@xxxyz/dsh-mcp-manager`、`dsh-approval-mode`、`dsh-context`、`dshmarket` 的缺项，本插件不在其中；补上四个 optional peer 后，在含本插件的 lockfile 上同一命令得到 `missing: {}`、退 0 |
| 2026-09-21 | Desktop 2.0.11 / dsh 0.1.5-rc.2 | 设置与卡片这条链**读实现**核对（`installSection` 签名与 hooks、namespace 文法、schema 必须可被浏览器重建、卡片按 namespace 派发、`dsh.client` 的解析与 bundle 缺失时的失败方式、客户端 scope 的 `bind`/`mutate` 形状） |
| 2026-09-25 | Desktop 2.0.14 / dsh 0.1.7-rc.1 | 上一行的**全部结论作废**：`installSection` / `settingsScope` / `settings.plugin.item` 三处都已移除或改名。事故、根因、现场证据与新形态见 §3.6；新形态的全部检查见 §3.4 |

### 3.6 事故与根因：客户端启动失败 → 安全模式（2026-09-25）

**现象。** 升级到 Desktop 2.0.14 / dsh `0.1.7-rc.1` 后，只要 profile 里**启用**本插件，
DSH 就起不来，落到恢复界面（安全模式）；把插件从 profile 里禁用后恢复正常。

**现场证据**（`%APPDATA%\DSH Desktop\logs\dsh-2026-09-25.log` 与 `.error.log`）：

```
dsh-plugin-desktop: renderer boot failed (plugins: dsh-import-copilot-files): The client Loader did not provide an error message.
RendererStartupFailure: Renderer boot failed for 1 plugin(s)
    at start (…/resources/app/lib/main.js:5227:49)
```

**链路。** Desktop 的浏览器半侧（`resources/app/lib/client.js` 的 `rendererBootReport`）在
客户端 Loader 结算之后，把**任何 fiber 状态不是 ACTIVE 的条目**都算作失败：

```js
const plugins = [...loader.entries()]
  .filter(entry => entry.fiber?.state !== 2 /* ACTIVE */)
  .map(entry => entry.options.name)
return error === undefined && plugins.length === 0
  ? { status: 'healthy' }
  : { status: 'failed', plugins, … }
```

fiber 停在 `pending`（等待一个永远不出现的服务）时 `loader.await()` 并不 reject，所以报告里
**没有** `error` 字段 —— 这正是日志里「did not provide an error message」的来历。
主进程把 `failed` 变成 `RendererStartupFailure`，启动流程随即进入恢复/安全模式。

**根因。** 旧实现把 `settingsScope` 放在**静态 `inject` 列表**里：

```js
const inject = ['slots', 'locale', 'settingsScope']   // 旧 lib/client.js
```

`0.1.7` 把该服务改名为 `configForms`，于是这个 fiber 永远等不到它 → pending → 上面那条报告。
同一版本的另外两处改动也让旧实现失效（但都不是启动失败的原因）：

- `settings.plugin.item` 这个 slot 已不存在（页面改用 `plugins.item`，见 §3.4 实测）；
- host 侧的 `ctx.settings.installSection(...)` 已从 `@deepseek-ai/dsh-settings` 移除，
  设置文档改为由插件自己的 `Config` schema 派生、按 Loader 条目 id 寻址。

**对照实验**（解释「为什么装了别的插件却没事」）：同 profile 里 `dshmarket` 的客户端也用
`settingsScope`，但它只写在**嵌套的 `ctx.inject(['settingsScope'], …)`** 里 —— 服务不存在时
回调不执行、那张设置页不出现，而 fiber 照常激活。**只有写进静态 `inject` 才是致命的。**

**修复。** 见 §3.4 与 [design.md §3.8](./design.md)：静态 `inject` 收敛为客户端的
`['slots', 'locale', 'configForms']`（host 侧仍是 `['skills']`），页面注册到 `plugins.item`
（cell id = 条目 id），设置文档由导出的 `Config` schema 提供（`paths` 声明为 `.volatile()`），
host 侧不再调用任何 Settings 服务方法。

### 3.7 从旧版升级时那条「用户已保存的 paths」

`0.1.7` 的 `dsh-settings` 会把 `$DSH_HOME/settings.yaml` 迁进 profile patch，**按小节名匹配
Loader 条目 id**，并且只带了三条别名（`ui-developer-tools` / `ui-onboarding` / `shell`）。
本插件在 `0.1.7` 之前的用户层小节名是旧命名空间（`import-vscode-ai-files` 或
`import-copilot-files`），**匹配不到新条目 id `dsh-import-copilot-files`**，迁移时会记一条
`settings: section … was not imported into entry …` 的警告，那份覆盖只留在改名后的
`settings.yaml.imported` 里 —— 也就是**升级后 `paths` 会回到组合层的默认值**。

手工迁移（一条，可选）：把那份值写进 profile 自己的 patch 层，与卡片保存的落点相同 ——

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: dsh-import-copilot-files
  config:
    paths:
      - C:\Users\<user>\.copilot
```

本机实测（2026-09-25）：`~/.dsh/settings.yaml.imported` 里的 `import-vscode-ai-files` 小节
从未被迁进 profile patch，`~/.dsh/profiles/desktop/cordis.patch.yml` 里只有一行
`- id: dsh-import-copilot-files` + `disabled: false`，没有 `config`。

## 4. 还没实测的部分（做完请划掉）

这些是在运行中的 DSH 里**没有**跑过的，代码按实现写，但没到「看见它工作」的程度：

- [ ] 卡片真的出现在 **设置 → 插件**里（要重装插件 + 重启 DSH，见 [development.md §2.3](./development.md)）。
  当前 profile 里插件处于 `desktopDeselectedBundles`，本轮没有重启验证——原因见该节。
- [ ] 展开后的卡片样式与同页其他插件一致（行编辑器的 token 取自主题服务，但没有与真实 GUI 逐像素比对）。
- [ ] 「浏览…」在 DSH Desktop 窗口里弹出 Windows 选择框并填回该行；两条路由都不存在的部署
  不渲染该按钮（手填路径），路由存在但拒绝选择时显示提示而不是无反应。
- [ ] 保存后 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里该条目出现 `config.paths`，
  且下一个模型步骤开始生效（`verify:settings` 只验证到**写出的行配置**这一层，没经过真实
  `configEditor.edit` 落盘）。
- [ ] 「恢复默认」清掉用户覆盖、值回到组合配置（「放弃」只丢弃草稿）。
- [ ] `loader/volatile-update` 在真实热重载里的触发时机（离线用例是手工发出该事件）。
- [ ] `whileServed` 在 `Config` 解析不到（无 schemastery）时确实**不注册**任何 cell。

[development.md §2.3](./development.md) 的手工流程覆盖前四条。

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
应为 `missing: {}` 且退 0 —— 它声明的四个 peer 全是 optional，optional 的缺项不进这份清单；
但**范围必须能匹配上 profile 里实际装的那一版**：`>=0.1.7-rc.1 <0.2.0` 匹配
`0.1.7-rc.1`，`^0.1.1-rc.2` 不匹配（§1.3），写错会从「missing」变成一条 invalid peer。

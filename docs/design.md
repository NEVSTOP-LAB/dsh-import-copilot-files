# dsh-import-copilot-files 设计文档

## 1. 背景与目标

VSCode / Copilot 已经有一套仓库级 AI 配置约定：`.github/copilot-instructions.md`、
带 `applyTo` 作用域的 `.github/instructions/*.instructions.md`、以及
`.github/skills/<name>/SKILL.md`。这些文件天然属于**仓库**，不属于任何单一编辑器。

目标是把它们也喂给 DSH，并且**不要求用户维护第二份配置**：

- 同一份 `.github` 在 VSCode 和 DSH 里都生效；
- 行为尽可能与 VSCode 一致（尤其是 `applyTo` 的作用域语义）；
- 对 DSH 本身的依赖面尽可能小，DSH 升级时坏得少、坏得可见。

## 2. 总体架构

插件是**一个 host 平面的组合行**（`cordis.patch.yml` 里插一行），加上一个只为设置卡片存在的
browser half：

- 它**不发布任何 service**，所以不需要 `isolate` realm，可以松散地放在 host 组合里
  （它注册的是一个 settings namespace，那不是 Cordis service）；
- host 平面注册进的是注册表的**全局层**，对每个 preset、每个会话生效 ——
  这正是「仓库级配置到处生效」需要的语义；
- GUI 里的注入行和技能目录都是既有客户端的既有渲染；唯一的 Client half 是「插件配置」页里
  那张改 `paths` 的卡片（§3.8）。

### 2.1 为什么不是 agent preset 平面

preset 平面看起来更"就近"（一次会话一实例），但**走不通**：
`@deepseek-ai/dsh-tool-cordis` 在 `lib/index.js` 里无条件
`ctx.cordisInspect.register(provider)` 注册**进程级** Host Inspect provider，没有 realm
隔离。DSH Desktop 是长驻进程，于是两个含 `tool-cordis` 的 preset 无法共存 ——
把插件放进 `cordis` 的 preset 副本会在挂载时就撞上
`inspect provider "Service" is already registered`。

对照实验：把同一份 composition 里**唯一**一行 `tool-cordis` 禁用后，
`agentPresets.standingKeyFor` 立即 `mounted OK`；不禁用则失败。这一条排除了 preset 平面。

顺带一提，host 平面还带来两个好处：不必让用户切 preset；`dsh plugin add` 装完即对所有会话生效。

## 3. 关键机制

### 3.1 发现与作用域

扫描的单位是**配置目录** —— 一个按 `.github` 摆放的目录（`copilot-instructions.md`、
`instructions/`、`skills/`）。两种东西会产生它：

- **cwd 走查**：cwd 本身和它下面 `scanSubdirectories` 层（默认 1）的直接子目录各是一个
  **项目根**，配置目录是 `<根>/.github`。`.github/instructions/` 内部递归到深度 4。
- **`paths` 条目**：每个条目**就是**配置目录（等价于项目根的 `.github`，它下面不再有
  `.github` 段）。`instructionDirs` / `skillDirs` 拼到它上面时先去前导的 `.` 段、再去前导的
  `.github` 段，其余部分原样拼接（cwd 侧不剥离、仍旧拼到项目根上，所以 `custom/rules` 这类
  自定义目录在两侧都按原样拼接）；剩下的部分里若**仍含** `.github` 段（`x/.github/y`）该条目
  被拒绝，而走查本身在配置目录上跳过隐藏目录 —— 于是 `.github`、`.`、`./.github`、`''`、`/`
  这些退化写法都落在配置目录上、却依然读不到它内部的 `.github` 树。这层过滤只作用于
  **指令文件的走查**（`walkInstructionFiles` 的 `skipHidden`，配置目录才开）；项目根侧的同一条
  指令文件走查不过滤 —— 两边刻意不对称：配置目录里的点目录是内容，而项目根里的 `.github`
  正是配置本身。另外注意这条说的是
  **条目自身的走查** —— 若该目录同时落在 cwd 走查范围内，那棵树仍可能以项目根 `.github` 的
  身份被读到，那是另一侧的规则。`scanSubdirectories` 不作用于它 —— 它的子目录是内容而不是更多
  的配置目录。

两类只在 `rootDir`（`applyTo` 的匹配锚点）上分叉：cwd 侧是项目根，`paths` 侧是该条目自身。
除此之外共用一条代码路径，所以「工作区外的共享规则」不需要第二套实现，`.github` 语义也不会
在两侧漂移。两个单位可能解析到**同一个源文件**（`paths` 点名一个已在走查里的目录，而
`instructionDirs` 不以 `.github` 开头时两侧的基目录相同）——发现结果按绝对路径去重，只保留
第一个单位，因此那条记录的 `rootDir` 也取自第一个单位：自定义 `instructionDirs` 时，子项目根
里那份文件的 `applyTo` 锚点会落在父根上。路径由 `resolveConfiguredPath` 定位：相对 cwd，或以
`~` 开头时相对用户主目录（条目里只有**开头**的 `~` 有这层含义，`~name` 与 `a/~/b` 是普通相对
路径；环境变量与通配符不展开）。这个函数是导出的，`index.js` 的目录失效判定复用它，两处不会
各写一份解析。不存在的路径贡献为空 —— 发现是「读盘上有什么」，不是报错。
**已经扫过的配置目录不会被走第二遍**（cwd 走查已经读过每个项目根的 `.github`，再点名它等于
没点；重复点名同一个条目同理）。比 cwd 预算更深、但被 `paths` 点名的目录仍会被扫 ——
点名就是请求。`paths` 的默认值是 `['~/.copilot']`（`index.js` 的 `DEFAULT_PATHS`，组合层与
设置 schema 同源）：每个会话默认带上当前用户的 Copilot 家目录，也就是 `copilot-instructions.md`
加 `skills/`；它只是一个普通条目，插件页里删掉并保存成 `paths: []` 即可关闭。

这样 `D:\NEVSTOP-LAB` 这类「多 repo 工作文件夹」就成立，且各 repo 互不干扰。
**刻意不向上找祖先链** —— 这与 DSH 原生 `dsh-agent-instructions` 的语义不同
（它按 project root → cwd 的祖先链找 `<dir>/<candidate>`）。两者混用会产生难以解释的
重复与遗漏，所以本插件自己管全部三类文件，行为一致、可解释。

**AGENTS.md 是刻意的边界**：它由核心按上面那条祖先链读取，只在当前工作目录这条链上生效，
`paths` 与子目录根都不贡献它（`lib/discover.js` 里根本没有这个名字，负例由
`test/discover.test.js` 钉住）。

cwd 之下的文件用相对路径做标题；`paths` 扫到的文件不在 cwd 下，`..\..` 链说不清位置，
于是用**绝对路径**（正斜杠化）做标题。`applyTo` 相对**该文件所属的配置目录的锚点**匹配 ——
cwd 侧是项目根，`paths` 侧是该条目自身 —— 否则 `src/*.ts` 这种模式在子 repo 或共享目录里
永远匹配不上。`lib/glob.js` 实现了 `**`、`*`、`?`、`{a,b}`、`[abc]`，并且**按括号深度切分
逗号**（朴素的 `split(',')` 会把最常见的 `**/*.{ts,tsx}` 切成两半）。

没有 `applyTo` 的文件常驻；有的只在会话**真的观察过**匹配文件之后才注入。
「观察过」来自 `fs/observed`。

### 3.2 注入：`agent/pre-step` 与两处内部契约

指令经 `agent/pre-step` 作为一条 **user 消息**折进当前步骤的消息批次，带

```js
source: { kind: 'plugin', plugin: 'import-copilot-files', form: 'instructions' }
```

客户端把这条消息渲染成一条**上下文注入**行：行标题固定为「上下文注入」（`provenance.role`
为 `recall` 时是「跨会话召回」），行内的来源标签取自 `source.plugin`，正文与折叠摘要由
`source.form` 决定（`KNOWN_FORMS = ['instructions','catalog','snapshot','notice','relay','recall']`，
`form: 'instructions'` 走 `InstructionsBody`）。

> **为什么不用 `ctx.systemPrompt.context`**：它的正文会被收进 `dsh-system-prompt` 那条
> 上下文注入行（`form: 'snapshot'`，来源标签是 `@deepseek-ai/dsh-system-prompt`），看不出是
> 哪个仓库的配置，看上去就像"根本没注入"。
> `agent/pre-step` + `form: 'instructions'` + 自己的 `source.plugin` 才能拿到与 AGENTS.md
> 同级、可辨认来源的独立行。

代价是两处**内部契约**（升级时优先查，见 [compatibility.md](./compatibility.md)）：

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
会把本插件的规则排到 AGENTS.md **前面**。

因此这里**追加到末尾**：顺序与注册顺序无关 —— AGENTS.md 在前，本插件注入的指令在后。

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
- `source: 'project-copilot'`、`rank: 150`（夹在内置的 `project-dsh`(100) 与
  `project-agents`(200) 之间）、`resourceBase` 指向 bundle 目录，让 bundle 内的
  `references/` 可被引用。
- `disable-model-invocation` / `user-invocable` 与原生语义一致；拼写非法则丢弃该技能并告警。

目录失效：provider 是全局的、一个实例服务所有工作区，所以**任何配置目录**的观察都会调用
`control.invalidate()`，而不是只认当前会话 cwd 下的。配置目录有两种形状 —— `.github` 树，
以及 `paths` 条目自身（它没有 `.github` 段）—— 只匹配前者会让共享目录里改技能永远不刷新，
所以 `index.js` 的 `touchesConfigDir` 两种都认。

### 3.6 字节预算

`maxBytes`（默认 65536）限制单次注入。规则：先省略整份较宽泛的文件，再截断最后一份，
并在正文里写明丢了多少、截断了什么。**渲染结果绝不超出预算** —— 包括"省略提示"自身的
预留，以及 `[truncated]` 后缀的长度。

### 3.7 零依赖与同步 IO

`frontmatter.js` 与 `glob.js` 都是自己写的极小实现，只用 `node:` 内置模块。
原因不是洁癖：profile 本地插件向上找不到 harness 自己的 `node_modules`，
任何 `@deepseek-ai/*` 或第三方 import 都会在加载期失败。

`dependencies` 为空，`peerDependencies` 里只列宿主契约（`@deepseek-ai/cordis`、
`@deepseek-ai/dsh-settings`、`@deepseek-ai/schemastery`、`react`）并且**四个全部 optional**：
这个插件在 profile 里本来就能缺其中任何一个（见 §3.8 的两处可选），而 optional 的 peer 不会进
pnpm 的 peer 问题清单，所以这份声明既如实又不会给别人的安装添警告。加载期依赖因此仍是零。

唯一的 import 例外是 §3.8 的设置 schema，它对 `@deepseek-ai/schemastery` 有硬需求（见该节），
但走的是**惰性动态 import**，因此加载期依赖仍然是零：clone 下来没有 `node_modules`
也照样 `npm run check`；解析不到 schemastery 的部署丢的是那张卡片，不是整个插件。

IO 全部同步（`discover()` 是同步函数）：零缓存、零失效逻辑，每个 pre-step 直接重读磁盘。
代价是每步的文件系统开销（几十次 stat/readdir，亚毫秒级），换来的是"改文件下一步生效"
这个用户可见的性质。

### 3.8 运行时设置与「插件页」卡片

`paths` 需要能在 GUI 里改，而 DSH 的做法是 **settings namespace + 浏览器卡片**：

```
host: ctx.inject(['settings'], c => c.settings.installSection(ctx, ns, schema, config, hooks))
                         ↑ 组合配置当 base          ↑ 服务消失时回退到 config
browser: ctx.settingsScope.bind({ namespace: ns })
         ctx.slots.register({ name: 'settings.plugin.item', key: ns, locale: ns, … }, Card)
```

四周内部契约（签名与实测依据见 [compatibility.md §3.4](./compatibility.md)）：

1. **`ctx.inject(['settings'], …)` 而不是静态 `inject`。** `settings` 是可选服务：
   在它上线前调用回调不会发生；`installSection` 在服务消失时把 source 换回组合配置。
   于是「没有设置服务」这条路径不需要任何分支代码。
2. **`setSource` 给的是一个 getter，不是值。** 插件把它存成 `readSettings`，每次用之前调用
   （`settings()`），所以一步之内的两次读取不会拿到两个版本，也不存在需要失效的缓存。
3. **schema 必须是真正的 schemastery schema。** 服务本身不校验 schema 的形状，但浏览器要靠
   `schema.toJSON()`（`{ uid, refs }` 信封）把它重建出来才能渲染表单；手写的形状像 schema 的
   对象能通过 host，却会让卡片拿不到可编辑的值。所以这里不用 `lib/frontmatter.js` 那种
   「自己写一个」的做法。
4. **卡片的 slot key 就是 namespace**（`settings.plugin.item` 按 namespace 派发）。两半各自
   硬编码同一个字符串：host 侧的 `SETTINGS_NAMESPACE` 与 browser 侧的 `NAMESPACE`
   —— 这是本插件唯一一处「两半必须一致」的耦合，`test/settings.test.js` 与
   `test/client.test.js` 各钉住一半。

卡片只改 `paths`，其余字段仍只在组合配置里。写入走客户端 settings scope：
保存时带**草稿开始那一刻的 revision**，被并发改动抢先就拒绝而不是覆盖；保存成功后**回读**
宿主给的值确认，而不是假定写入成功。「放弃」只丢弃未保存的草稿；要清掉**已存储**的用户覆盖
是「恢复默认」的事（`unset`，字段确实被覆盖时才出现），清完值重新继承组合配置。
落点是 DSH 自己的用户设置文档，工作区文件一个不写。

卡片的外观**逐类照抄**宿主的 `PluginCard` 与它的字段样式：`.5px` 的 `border-l4`、16px 圆角、
`bg-layer-3` 上的折叠标题栏（展开后才渲染 body）、字段的 label + hint + input，以及页脚右侧的
「放弃 / 保存」。原因是「插件配置」页只负责排版与按 namespace 派发，**不画卡片** —— 容器是
各插件自己的。chevron 与胶囊按钮按 primitives 的几何手绘：本 bundle 只允许 `require('react')`。

「浏览…」按**当前部署能用的路由**取目录：DSH Desktop 的 win32 profile 会把
`dsh-host-directory-picker-auto` 禁用掉、改挂 `browse` 后端，而 `browse` 没有 `pick` 能力
（Remote 会答 `directory-picker/unavailable`），所以那里走 DSH Desktop 装在页面上的
`window.__DSH_DESKTOP_PICK_DIRECTORY__`；其余组合挂的是 `native` 后端，走
`uiWorkspace.pickDirectory()`。路由在**每次点击时**解析（宿主按 slot entry 记忆化注入的
props）：`hasChooser` 为假时卡片**不渲染「浏览…」按钮**（路径手填），路由存在但这次选择被
拒绝时给出提示，不静默失败。

提交后的变更还会调用 `control.invalidate()` 让**技能目录**失效。设置写入不碰文件系统，
`fs/observed` 不会给它任何信号，不接线的话保存了新路径也要等到下一次无关的文件观察才生效。

仓库内的 bundle 是**手写的 lazy-CJS**（`window.__ModuleLoader__.load({ id, factory })`），
不引入任何构建步骤——与 dsh-git-rollback 这类第三方插件的做法一致。

## 4. 源码结构

| 文件 | 职责 |
| --- | --- |
| `index.js` | 插件入口：`agent/pre-step` 注入、skill provider、`fs/observed`、设置命名空间的接线 |
| `lib/discover.js` | 扫描配置目录（cwd 各项目根的 `.github`，以及本身就是配置目录的 `paths` 条目），产出 instructions 与 skills；并导出配置路径的解析（cwd 相对、`~` 主目录）与绝对路径判定 |
| `lib/frontmatter.js` | 极简 YAML frontmatter（标量、引号、`\|` `>` 块、行内与列表数组、注释） |
| `lib/glob.js` | `applyTo` 的 glob → RegExp，含括号感知的逗号切分 |
| `lib/settings.js` | 设置命名空间的 schema（`z` 由调用方传入，所以本文件可离线测试） |
| `lib/client.js` | browser half：设置卡片（手写 lazy-CJS bundle，无构建步骤） |
| `scripts/verify-settings-schema.mjs` | 拿真实 schemastery 复核设置链（找得到才跑，找不到跳过并退 0） |

## 5. 已知边界与后续

- **不监视文件**：没有 watcher。`.github` 的增删改在"下一个模型步骤"生效（因为每步重读），
  但**技能目录**还需要一次失效信号：`.github` 树与 `paths` 条目下的文件观察由 `fs/observed`
  提供，设置卡片提交的 `paths` 不碰文件系统、拿不到这个信号，所以卡片的提交回调显式调用
  `control.invalidate()`（见 §3.8 末段）。
- **只写一处**：插件不写工作区任何文件。唯一的写路径是设置卡片提交的 `paths`，它由宿主
  设置服务落进 DSH 自己的用户设置文档。
- **卡片只覆盖 `paths`**：`maxBytes`、`scanSubdirectories`、`instructionDirs`、`skillDirs`
  仍然只能在组合配置里改（改完要重启，因为 profile patch 层不热重载）。
- **只展开开头的 `~`**：`paths` 条目里只有开头那个 `~`（单独一个，或后跟 `/`、Windows 上 `\`）
  表示用户主目录，`~name` 与 `a/~/b` 都是普通相对路径；通配符与环境变量不展开。相对路径相对
  会话 cwd 解析，所以「相对路径」在不同会话里指向不同位置，写绝对路径或 `~` 更稳。默认条目
  `~/.copilot` 正是靠这一条在任何机器上指向同一个位置。
- **`paths` 是配置目录，不是项目根**：一个条目恰好是一个配置目录（等价于项目根的 `.github`），
  `scanSubdirectories` 不作用于它，它内部的 `.github` 树不被**条目自身的走查**读取（若它同时
  也在 cwd 走查范围内，那棵树仍可能以项目根 `.github` 的身份被读到），它下面的子目录也不会被
  当作更多的配置目录。该字段尚未随任何版本发布（见 CHANGELOG），所以没有已发布的旧配置需要
  迁移 —— git 安装路径上用户层写下的旧命名空间小节见 CHANGELOG 的改名一条；
  把工作区外的仓库根改写成 `paths: [<repo>/.github]` 会同时把 `applyTo` 锚点从仓库根移到
  `.github`。
- **不处理 `AGENTS.md`**：它属于核心的 `dsh-agent-instructions`（project root → cwd 祖先链），
  只在当前工作目录这条链上生效；`paths` 与子目录根都不贡献 AGENTS.md。想要共享的 AGENTS.md
  只能靠核心自己的机制，不是这个插件的事。
- **不覆盖** `.github/prompts/*.prompt.md`、`.github/agents|chatmodes/*.md`、
  `.vscode/settings.json` 里的指令路径，也不兼容 `.claude/skills` 等其他技能根。
- **子 agent 也会注入**：host 平面注册是全局的，所以子 agent 的组装同样带这些指令。
- **恢复会话时可能重复注入一次**：`injectedText` 是内存态，进程重启后第一次组装会重新注入。
  无害，但会多一条消息。

验证记录见 [compatibility.md](./compatibility.md)。

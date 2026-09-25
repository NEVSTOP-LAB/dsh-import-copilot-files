# 开发与验证

## 1. 目录结构

```
dsh-import-copilot-files/
├── README.md            # 用户可见：功能、安装、配置
├── README.en.md         # 同上（英文）
├── CONTRIBUTING.md      # 协作流程
├── CHANGELOG.md         # 每个版本的变更；发布正文的来源
├── docs/                # 维护者文档：design / development / compatibility / pitfalls
├── package.json         # bundle manifest（dsh.bundle.patch）与 client manifest（dsh.client）
├── cordis.patch.yml     # 组合层：插入插件行
├── index.js             # 插件入口：指令注入 + skill provider + fs/observed + Config（GUI 里那行叫「上下文注入」）
├── lib/
│   ├── discover.js      # 扫描配置目录，产出 instructions 与 skills
│   ├── frontmatter.js   # 极简 YAML frontmatter
│   ├── glob.js          # applyTo 的极简 glob → RegExp
│   ├── settings.js      # Config schema，即该条目的设置文档（z 由调用方传入）
│   └── client.js        # browser half：plugins.item 上的设置页（手写 lazy-CJS bundle）
├── scripts/
│   ├── release-notes.mjs # 由 CHANGELOG 组装 Release 正文（零依赖）
│   ├── pack.mjs          # 跨平台打包（npm pack → dist/）
│   └── verify-settings-schema.mjs # 拿真实 schemastery 复核设置链（§3）
└── test/
    ├── *.test.js        # node:test
    └── fixtures/        # 假的 repo 结构，供测试与手工验证
```

Host half 是 `index.js`；Client half 只有一张设置卡片（`lib/client.js`）。
GUI 里看到的那条注入行是既有客户端对 `source.form` 的既有渲染，不需要注册任何 UI；
技能目录同理。各文件的职责见 [design.md §4](./design.md)。

## 2. 本地检查

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
npm test          # node --test test/*.test.js
```

CI（`.github/workflows/ci.yml`）在 ubuntu 上跑同一条命令。

> [!NOTE]
> 受限沙箱里 `node --test` 的并行 runner 会 spawn 子进程并被 pipe 限制挡住（EPERM）。
> 那种环境下逐个文件直接跑即可，六个测试文件都支持单独执行：
> `node test/glob.test.js`、`node test/frontmatter.test.js`、`node test/discover.test.js`、
> `node test/index.test.js`、`node test/settings.test.js`、`node test/client.test.js`。
### 2.1 测试用什么驱动

`test/index.test.js` **不需要 DSH**：它对着一个假的 Cordis 上下文驱动**真实的插件对象** ——
按真实语义跑 `agent/pre-step` 瀑布（含 `next()` 链）、真实的 skill provider、真实的
`fs/observed` 监听器。所以绝大多数行为 clone 之后立刻可验证。它还带一条端到端：把 `paths`
的**活引用**换掉（`volatileField(...)`，就是 `.volatile()` 字段被解析成的那个形状）之后，
新值真的出现在下一次注入与技能目录里，而 `loader/volatile-update` 会让技能目录失效。

`test/settings.test.js` 用注入的 schema 替身（`configSchemaFor(z)`）钉住 `Config` 的形状：
字段、默认值、**只有 `paths` 是 volatile**、`normalizeSettings` 读的是活引用而不是快照；
`test/client.test.js` **跑的是真实的 `lib/client.js`** —— 它按客户端模块系统的方式执行那个
bundle（假的 `window.__ModuleLoader__`、假的 `require`、一个 React 替身），再驱动
`apply(ctx)` 与页面组件，包括注册（entry id / `plugins.item` / 两种 view）、暂存、保存
（revision 与回读确认）、只读态与样式安装/卸载。

每次改行为，先问「这条能被 `node --test` 钉住吗」。不能的部分才留给人眼验证（§2.2）。

### 2.2 端到端验证（可选）

三条 host 接缝都可以用动态 Cordis 插件在真实会话里探针验证，不必改仓库代码：

1. `agent/pre-step` —— 注册一个监听器，注入一条带
   `source = { kind: 'probe', form: 'instructions', changes: [{ action: 'set', path: 'probe.md' }] }`
   的消息，确认它作为 user 消息到达模型，并在 GUI 注入面板里显示成**独立条目**（来源标签取自
   `source.kind`）。**`kind` 不能写成 `'plugin'`**：那是退役的 V3 包装，v4 会在写入时拒绝
   （`format v4 message requires a producer-owned source kind`），探针会让整个 turn 失败 ——
   见 [compatibility.md §3.8](./compatibility.md)。
2. `skills.list({ cwd })` / `skills.get(name, { cwd })` —— 确认 provider 对该工作区返回的
   `invocation` 策略、`resourceBase` 与正文。
3. `fs/observed` —— 确认 `actor.agent` 存在（按会话分桶的前提）。

`cordis-plugin-development` skill 里有完整流程。**升级 DSH 之后先查 §1.2 的静态 `inject`
列表**：里面出现一个没人提供的服务名，插件 fiber 会永远 pending，客户端启动报告把它算作
「加载失败」，Desktop 于是进恢复界面 —— 见 [compatibility.md §3.6](./compatibility.md)。

### 2.3 设置页怎么验证

设置页只有在**装好的 profile 里、DSH 重启之后**才会出现，所以它没有 §2.1 之外的自动化路径：

1. `npm run pack`，再 `dsh plugin --profile <p> add ./dist/dsh-import-copilot-files-<v>.tgz`，
   然后**重启 DSH**（profile patch 层不热重载）。
2. 打开 **设置 → 插件**，确认本插件那张卡片出现，标题与「导入 Copilot 文件」
   （英文界面 `Import Copilot Files`）一致 —— 出现本身就说明四件事同时成立：`Config`
   解析成功且含 volatile 字段、`dsh-settings` 提供了该条目的表单、`dsh.client` 被扫描到、
   bundle 被提供且注册的 cell id 与条目 id 相同。
3. 点开卡片，确认页面正文里的字段与页脚，以及行内的「浏览…」：在 DSH Desktop 窗口里按它
   应弹出 Windows 系统选择框，选中的目录直接填进那一行（仍是未保存的草稿，要再点「保存」）。
4. 加一个真实存在的共享配置目录、保存，然后确认两件事：
   `~/.dsh/profiles/<profile>/cordis.patch.yml` 里该条目出现 `config.paths`；新会话的
   「上下文注入 · `import-copilot-files`」行里出现该目录下的指令（标题是绝对路径）。
   注意该目录**自己**就是 `.github` 的等价物：直接放 `copilot-instructions.md`、
   `instructions/`、`skills/`，不要在它下面再建 `.github`。
5. 「恢复默认」（字段被覆盖时才出现）应清掉用户覆盖，值回到 `cordis.patch.yml`；
   「放弃」只应丢弃未保存的草稿，不动已存储的值。
6. 未实测清单见 [compatibility.md](./compatibility.md)——**做完这几步就把对应条目划掉**。

> [!WARNING]
> 这一步会把本插件重新装进你正在使用的 profile：**在 dsh ≥ 0.1.7 上，一个静态 `inject`
> 里挂着不存在服务名的 bundle 会把 DSH 拖进安全模式**。本仓库的当前版本已经修好，但如果你在
> 验证旧提交，请留好 `dsh plugin --profile <p> remove dsh-import-copilot-files` 这条退路。

## 3. 设置链：`npm run verify:settings`

`test/settings.test.js` 用替身钉住 `Config` 的形状，但没有真实包就无法回答那两个真正致命的
问题：host 给的表单，**浏览器能不能重建**？以及 `dsh-settings` 会不会把它**投影/写坏**？
客户端是按 `new Schema(serialized)` 从 `toJSON()` 的信封重建的，重建失败时该 namespace
拿不到任何可编辑值、而且**一声不吭**；投影只认 `.volatile()` 字段，标错一个字段就是一张空页面
或一条被破坏的 profile patch。

`scripts/verify-settings-schema.mjs` 就是拿**真实的 `@deepseek-ai/schemastery` 与真实的
`@deepseek-ai/dsh-settings`** 把这条链走一遍：解析组合配置（默认值、用户层）、拒绝页面不该
接受的写入、`toJSON()` 序列化、再从信封重建并校验；然后用原型实例 + 假 `configEditor`
驱动**上游自己的** `SettingsForms.describe()` 与 `update()`，核对 descriptor（`ns`、只含
`paths` 的 `value`、数值 `revision`）与写出的行配置（保留 `maxBytes` / `scanSubdirectories`）；
最后比对 `index.js`、`lib/client.js`、`cordis.patch.yml` 里那个 id 是否是同一个字符串。
它在找不到 schemastery 时**跳过并退 0**（所以不进 `npm run check`），找得到就**认真失败**：

```sh
npm run verify:settings
# 或指定一份安装 / 一个具体的 schemastery：
node scripts/verify-settings-schema.mjs --dsh-app <resources/app>
node scripts/verify-settings-schema.mjs --schemastery <specifier-or-path>
```

它从 `index.js` 导入 `SETTINGS_DEFAULTS` 与 `SETTINGS_ENTRY_ID`，默认值与条目 id 各只有一份。

## 4. 打包与发版

```sh
npm run pack        # → dist/dsh-import-copilot-files-<version>.tgz
```

发版：先在 `CHANGELOG.md` 写 `## [<version>]` 小节，把 `package.json` 的 `version` 对齐，
再打 tag 推送 `v<version>`。`.github/workflows/release.yml` 会校验两者一致、跑
`npm run check`、打包、用 `scripts/release-notes.mjs` 从 CHANGELOG 组装 Release 正文并附上
tarball。

Release 正文取自与 tag 同号的 CHANGELOG 小节，所以**先 bump 再打 tag**，顺序反了就发不出正确
正文：tag 先于版本号则工作流按「版本不一致」直接失败，tag 与旧版本号同号则把旧小节当成本次变更。
小节内**第一段是 Release 正文的开场**，写清这是哪一类发布（首个 tag / 破坏性变更 / 兼容范围）。
本节所述顺序在 `v0.2.0` 上实测通过（tag → 工作流 → Release + tarball 附件）。
改动插件 id / 设置命名空间这类对外标识后，发布号进一位 minor —— `v0.2.0` 就是这样来的。

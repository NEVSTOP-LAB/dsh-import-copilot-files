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
├── package.json         # bundle manifest（dsh.bundle.patch）
├── cordis.patch.yml     # 组合层：插入插件行
├── index.js             # 插件入口：指令注入 + skill provider + fs/observed
├── lib/
│   ├── discover.js      # 扫描 cwd + 直接子目录，产出 instructions 与 skills
│   ├── frontmatter.js   # 极简 YAML frontmatter
│   └── glob.js          # applyTo 的极简 glob → RegExp
├── scripts/
│   ├── release-notes.mjs# 由 CHANGELOG 组装 Release 正文（零依赖）
│   └── pack.mjs         # 跨平台打包（npm pack → dist/）
└── test/
    ├── *.test.js        # node:test
    └── fixtures/        # 假的 repo 结构，供测试与手工验证
```

Host half 就是 `index.js`。本插件**没有 Client half**：GUI 里看到的那条注入行是既有客户端
对 `source.form` 的既有渲染，不需要我们注册任何 UI；技能目录同理。

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
node --check scripts/pack.mjs
node --check scripts/release-notes.mjs
npm test          # node --test test/
```

> [!NOTE]
> 受限沙箱里 `node --test` 的并行 runner 会 spawn 子进程并被 pipe 限制挡住（EPERM）。
> 那种环境下逐个文件直接跑即可，四个测试文件都支持单独执行：
> `node test/glob.test.js`、`node test/frontmatter.test.js`、`node test/discover.test.js`、
> `node test/index.test.js`。

### 2.1 测试用什么驱动

`test/index.test.js` **不需要 DSH**：它对着一个假的 Cordis 上下文驱动**真实的插件对象** ——
按真实语义跑 `agent/pre-step` 瀑布（含 `next()` 链）、真实的 skill provider、真实的
`fs/observed` 监听器。所以绝大多数行为 clone 之后立刻可验证。

每次改行为，先问「这条能被 `node --test` 钉住吗」。不能的部分才留给人眼验证（§2.2）。

### 2.2 端到端验证（可选）

三条接缝都可以用动态 Cordis 插件在真实会话里探针验证，不必改仓库代码：

1. `agent/pre-step` —— 注册一个监听器，注入一条带
   `source = { kind: 'plugin', plugin: 'probe', form: 'instructions' }` 的消息，
   确认它作为 user 消息到达模型，并在 GUI 注入面板里显示成**独立条目**（标题取自
   `source.plugin`）。
2. `skills.list({ cwd })` / `skills.get(name, { cwd })` —— 确认 provider 对该工作区返回的
   `invocation` 策略、`resourceBase` 与正文。
3. `fs/observed` —— 确认 `actor.agent` 存在（按会话分桶的前提）。

`cordis-plugin-development` skill 里有完整流程。

## 3. 依赖面与兼容性

### 3.1 零 npm 依赖

`dependencies` 与 `peerDependencies` 都为空，唯一的 import 是 `node:crypto`、`node:fs`、
`node:path`。

这不是洁癖：**profile 本地插件向上找不到 harness 自己的 `node_modules`**，
所以 `lib/frontmatter.js` 与 `lib/glob.js` 只能自己写，也不能 import 任何 `@deepseek-ai/*`。
这条约束直接决定了 §3.2 的形态。

### 3.2 对 DSH 的依赖是 3 个接缝 + 2 处内部契约

| 用途 | 接缝 |
| --- | --- |
| 注入 instructions | `ctx.on('agent/pre-step', …)` |
| 注册 skills | `ctx.skills.registerProvider(create)` |
| 已触及文件 + 目录失效 | `ctx.on('fs/observed', …)` |

接缝之外还有两处**内部契约**（详见 [doc/design.md §3.2](./doc/design.md)）：
注入消息的四个字段，以及 pre-step decision 的形状。它们整个包在 try/catch 里 ——
形状变了只记一条 `console.error` 并跳过注入，不会弄坏整个 turn。

### 3.3 版本要求

没有可声明的 npm 下界（不 import 任何 DSH 包），兼容性由 §3.2 的清单决定。
**实测环境：DSH Desktop 2.0.11 / dsh `0.1.5-rc.2`**（与 `dsh-approval-mode` 相同）。

## 4. 兼容性校验怎么做

升级 DSH 之后，按顺序查：

1. `dsh --profile <profile> --dump-config` 里还有没有 `dsh-import-vscode-ai-files` 行。
2. 三个接缝还在不在 —— 用 `cordis_inspect_query` 查 `Event.listEvents` 与
   `Service.listService`。
3. 注入消息的四个字段（`id` / `role` / `content` / `source`）与 pre-step decision 的形状
   （`await next()` 之后返回 `{ …decision, messages }`）—— 对照
   `@deepseek-ai/dsh-llm/lib/types/message.js` 的 `createUserMessage`。
4. 客户端标题：`dsh-client-ui-trajectory` / `dsh-client-ui-chat` 的 `contextProvenance`
   与 `KNOWN_FORMS` 决定显示成「指令注入」还是「状态快照」。
5. `agent.session.header.cwd` 或 `actor.agent` 还在不在。
6. 先跑 `npm run check` 排除自己的逻辑回归。

### 4.1 校验记录

| 日期 | DSH | 结论 |
| --- | --- | --- |
| 2026-09-18 | Desktop 2.0.11 / dsh 0.1.5-rc.2 | 三个接缝与两处内部契约逐条实测通过；端到端验证见 CHANGELOG `0.1.0` 的「验证」小节 |

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
- **目录失效不能绑在会话 cwd 上**。provider 是全局的、一个实例服务所有工作区，所以任何
  `.github` 变更都要让它失效，而不只是当前会话 cwd 下的。
- **`disable-model-invocation: true` 会让技能不进目录**。这是既定语义，不是插件 bug；
  想让模型看到就不要写这一行（或写 `false`）。
- **Windows 上 git push 可能需要 TLS 兜底**。schannel 在某些环境取不到凭证
  （`SEC_E_NO_CREDENTIALS`，`curl.exe` 同样失败），换 OpenSSL 后端 + 从系统证书库导出的
  CA 即可：`git -c http.sslBackend=openssl -c http.sslCAInfo=<ca.pem> push`。

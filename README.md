# DSH-Import-VSCode-AI-Files

DSH 插件：把一个工作区自带的 **VSCode / Copilot 风格 AI 配置**加载进**每一个** DSH 会话。
同一份 `.github` 配置在 VSCode 和 DSH 里同时生效，不用维护两套。

也可以再指定若干**工作区之外**的配置目录（等价于项目根里的 `.github`，它下面不再有
`.github` 目录），让它们一起生效——一份共享规则喂给所有仓库。**默认就带一条**：当前用户的
`[user]\.copilot`（写成 `~/.copilot`，`~` 即用户主目录），也就是 Copilot CLI 自己的家目录，
那里放着 `copilot-instructions.md` 与 `skills/`。

> [!NOTE]
> 插件只**读取**工作区里的配置，不写任何工作区文件。它另外向 DSH 注册一个设置命名空间
> （`import-vscode-ai-files`），使「额外路径」可以在 GUI 的**设置 → 插件 → 插件配置**里直接改；
> 写入的只有这一个字段，落点是 DSH 自己的用户设置文档（`$DSH_HOME/settings.yaml`）。

## 功能

| 文件 | 行为 |
| --- | --- |
| `.github/copilot-instructions.md` | 常驻注入，等价 VSCode 的 repo-wide instructions |
| `.github/instructions/**/*.instructions.md` | 按 frontmatter `applyTo` 生效：没有 `applyTo` 的常驻；有 `applyTo` 的，只在本会话**真的碰过**匹配文件之后才注入 |
| `.github/skills/<name>/SKILL.md` | 注册为 DSH 技能：`name` + `description` 进技能目录，正文按需加载 |

`applyTo` 的匹配规则与 VSCode 一致：相对**该文件所属的那个根**匹配 —— cwd 侧是项目根，
`paths` 条目侧是条目自身（不是工作区根），支持 `**`、`*`、`?`、`{a,b}`、`[abc]`，逗号分隔多个模式。

`SKILL.md` 的 frontmatter 与 DSH 原生技能同义：

- `disable-model-invocation: true` —— 不进技能目录（模型看不到，但用户仍可用 `/name` 调用）
- `user-invocable: false` —— 不可被用户 `/name` 调用
- 两个键省略即允许；拼写非法会让该技能被跳过并打一条警告

### 扫描范围

扫描的单位是**配置目录** —— 一个按 `.github` 摆放的目录（`copilot-instructions.md`、
`instructions/`、`skills/`）。两种东西会产生配置目录。

会话 cwd 本身，加上它下面 `scanSubdirectories` 层（默认 1 层）的直接子目录：这些目录各是一个
**项目根**，配置目录是它的 `.github/`。`.github/instructions/` 内部再递归（深度上限 4）。

这样 `D:\NEVSTOP-LAB` 这类「多 repo 工作文件夹」就成立：文件夹自身和它直接下面的每个 repo
都会贡献自己的 `.github`，互不干扰。不向上找祖先链，也不下探更深的层。

`paths` 里的每个路径**本身就是配置目录**（等价于项目根的 `.github`，它下面不再有 `.github`）：
`paths: [D:\shared-ai]` 读的是 `D:\shared-ai\copilot-instructions.md`、
`D:\shared-ai\instructions\**` 与 `D:\shared-ai\skills\<name>\SKILL.md`。
条目自身的走查不会去读它内部的 `.github` 树；只有当这个目录**同时**落在 cwd 走查范围内时，
那棵树才可能以**项目根的** `.github` 身份被读到 —— 那是 cwd 侧的规则，两侧互不影响。
所以「一份共享规则放在工作区外，所有仓库共用」只需要把那个文件夹写进 `paths`。
每个条目恰好是一个配置目录，**不再**适用 `scanSubdirectories`：它的子目录是内容
（`instructions/`、`skills/`），不是更多的配置目录。

路径可以是绝对路径，也可以是相对会话 cwd 的路径，**或以 `~` 开头表示用户主目录**
（`~\x` 在 Windows 上等价于 `~/x`）；只有开头的那个 `~` 有这层含义，`~name` 与 `a/~/b`
都是普通相对路径，环境变量与通配符不展开。不存在的路径贡献为空，不会报错。
已经被扫过的配置目录不会走第二遍（点名 cwd 下某个项目自己的 `.github` 等于没点）。
`instructionDirs` / `skillDirs` 在 `paths` 条目上会**去掉前导的 `.github` 段**：默认值
`.github/instructions` 因此读作 `<路径>/instructions`，不以 `.github` 开头的目录原样拼接。
通过 `paths` 扫到的指令，标题用**绝对路径**（`..\..` 链说不清位置），`applyTo` 相对它自己的
配置目录（即该路径本身）匹配。

`paths` 的默认值是 `['~/.copilot']`——把**当前用户**的 Copilot 家目录当成一个配置目录，
所以每个会话都自动带上那里的全局指令与技能。不想要它就在插件页里删掉那一行并保存
（存成 `paths: []`），或直接改成一个别的目录。

**AGENTS.md 不由本插件处理**：它属于 DSH 核心的 `dsh-agent-instructions`，按 project root →
cwd 的祖先链读取，因此只在当前工作目录这条链上生效；`paths` 与子目录根都不会贡献 AGENTS.md。

## 在会话里看到什么

| GUI 的注入面板 | 来源 |
| --- | --- |
| **指令注入 · `import-vscode-ai-files`** | 本插件注入的 VSCode 风格指令，来自工作区的 `.github/` 或 `paths` 里的配置目录（含默认的 `~/.copilot`；标题取自 `source.plugin`） |
| **技能目录** | 上述配置目录的 `skills/` 中 `disable-model-invocation` 不为 `true` 的技能 |

顺序固定为 **AGENTS.md 在前，本插件注入的指令在后**。

内容变化时**追加**一条新的注入，而不是改写旧的；某个文件消失时会先给一条
`Instructions removed:` 说明，不会静默丢弃。

## 配置

插件行在 [`cordis.patch.yml`](./cordis.patch.yml)，`config` 字段：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `maxBytes` | `65536` | 单次注入的字节预算；超出时先省略、再截断，并在正文里说明丢了多少 |
| `scanSubdirectories` | `1` | cwd 下当作项目根的下探层数（只作用于 cwd 的走查） |
| `instructionDirs` | `['.github/instructions']` | `*.instructions.md` 所在目录（相对配置目录；`paths` 条目会去掉前导 `.github`） |
| `skillDirs` | `['.github/skills']` | `<name>/SKILL.md` 所在目录（同上） |
| `paths` | `['~/.copilot']` | **工作区之外**的配置目录，等价于项目根的 `.github`（它下面不再有 `.github`）；条目以 `~` 开头表示用户主目录 |

### 在插件页里改路径

`paths` 同时是该插件设置命名空间（`import-vscode-ai-files`）的一个字段，所以可以在
**设置 → 插件 → 插件配置** 里找到标题为「导入 VSCode AI 文件」（英文界面
`Import VSCode AI Files`）的那张卡片：逐行增删路径、保存、放弃或恢复默认。
卡片的形态与同页其他插件的卡片一致：折叠的标题栏（展开后才是字段），字段下面是
「添加路径 / 浏览… / 删除」，右下角是「放弃 / 保存」。

- 「浏览…」按当前部署**能用的那条路由**打开目录选择器：DSH Desktop 窗口用它自己的 Windows
  系统选择框，其余组合走宿主的原生选择器。两条路由都不存在时卡片会说明原因并让人手填路径，
  不会点了没反应。
- 卡片只改 `paths`；`maxBytes`、`scanSubdirectories`、`instructionDirs`、`skillDirs`
  仍只在组合配置里设。
- 写的是 **DSH 的用户设置文档**（`$DSH_HOME/settings.yaml` 的
  `import-vscode-ai-files:` 小节），不是工作区的任何文件；该文档是热重载的。
- 保存是**乐观并发**的：卡片带着打开草稿时的 revision 提交，期间别处改过就被拒绝并提示重试，
  不会覆盖别人的改动。保存成功后以宿主回读的值确认，而不是假定写入成功。
- 组合配置里的 `config` 是这一层的**基底**：「放弃」只丢弃未保存的草稿，而「恢复默认」
  （字段被覆盖时才出现）会清掉用户覆盖，值随即回到 `cordis.patch.yml` 里的那份。
- 设置服务不可用时（极少见）插件照常按组合配置运行，只是没有这张卡片。

## 安装

需要 [dsh CLI](https://github.com/deepseek-ai/deepseek-harness)。

从 GitHub 仓库安装：

```sh
dsh plugin --profile desktop add github:NEVSTOP-LAB/dsh-import-vscode-ai-files
```

> [!NOTE]
> `--profile web` 是默认 profile。桌面版（DSH Desktop）用 `--profile desktop`；其他 profile
> 换成对应名字即可。

建议锁定提交，避免后续更新改变实际内容：

```sh
dsh plugin --profile desktop add github:NEVSTOP-LAB/dsh-import-vscode-ai-files#<commit-sha>
```

也可以从 [Releases](https://github.com/NEVSTOP-LAB/dsh-import-vscode-ai-files/releases)
下载 tarball 安装：

```sh
dsh plugin --profile desktop add ./dsh-import-vscode-ai-files-0.1.0.tgz
```

安装后确认组合层里出现该插件：

```sh
dsh --profile desktop --dump-config
```

### 安装时那条 peer 依赖警告

`dsh plugin add` 会原样转发 pnpm 的输出，所以只要 profile 里**有任何一个**插件漏声明 peer
依赖，装什么都可能看到：

```
[WARN] Issues with peer dependencies found. Run `pnpm peers check` to list them.
```

**它说的不是本插件**：本插件的宿主包全部声明为**可选** peer，既不会缺，也不会被 pnpm 报出来。
想知道到底是谁缺什么，在 profile 目录里跑一次：

```sh
cd $DSH_HOME/profiles/<profile>
pnpm peers check
```

它逐条列出「哪个包缺哪个 peer、要求什么范围」。缺的那几条属于那些包自己，装上对应版本或等它们
补齐即可 —— 与本插件无关，也不影响本插件运行。

> [!IMPORTANT]
> DSH 的 profile patch 层**不热重载**，安装后要**重启 DSH**。
> 装好之后改仓库里的 `.github/**`，或改某个 `paths` 条目下的文件，都是**即时生效**的
> （每个模型步骤重新读盘）；只有改插件自身源码才需要再重启。

卸载：

```sh
dsh plugin --profile desktop remove dsh-import-vscode-ai-files
```

## License

MIT

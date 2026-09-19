# DSH-Import-VSCode-AI-Files

DSH 插件：把一个工作区自带的 **VSCode / Copilot 风格 AI 配置**加载进**每一个** DSH 会话。
同一份 `.github` 配置在 VSCode 和 DSH 里同时生效，不用维护两套。

也可以再指定若干**工作区之外**的路径，让它们按同样的规则一起生效——一份共享规则喂给所有仓库。

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

`applyTo` 的匹配规则与 VSCode 一致：相对**该文件所属的项目根**匹配（不是工作区根），
支持 `**`、`*`、`?`、`{a,b}`、`[abc]`，逗号分隔多个模式。

`SKILL.md` 的 frontmatter 与 DSH 原生技能同义：

- `disable-model-invocation: true` —— 不进技能目录（模型看不到，但用户仍可用 `/name` 调用）
- `user-invocable: false` —— 不可被用户 `/name` 调用
- 两个键省略即允许；拼写非法会让该技能被跳过并打一条警告

### 扫描范围

会话 cwd 本身，加上它下面 `scanSubdirectories` 层（默认 1 层）的直接子目录，各取自己的
`.github/`；`.github/instructions/` 内部再递归（深度上限 4）。

这样 `D:\NEVSTOP-LAB` 这类「多 repo 工作文件夹」就成立：文件夹自身和它直接下面的每个 repo
都会贡献自己的 `.github`，互不干扰。不向上找祖先链，也不下探更深的层。

`paths` 里的每个路径按**完全相同的规则**再扫一遍（它自己 + 同样层数的直接子目录）。
所以「一份共享规则放在工作区外，所有仓库共用」只需要把那个文件夹写进 `paths`。
路径可以是绝对路径，也可以是相对会话 cwd 的路径；不存在的路径贡献为空，不会报错。
重复点名一个**已经扫到过**的目录不会走第二遍 —— 第二遍会重新拿到一整层下探预算，从而多扫出
一层本来不该有的目录；反过来，比 cwd 的下探预算更深、但被 `paths` 点名的路径仍会被扫，
因为点名的意思就是要它。通过 `paths` 扫到的指令，标题用**绝对路径**（`..\..` 链说不清位置），
`applyTo` 仍相对它自己的项目根匹配。

## 在会话里看到什么

| GUI 的注入面板 | 来源 |
| --- | --- |
| **指令注入 · `import-vscode-ai-files`** | 本插件注入的 `.github` 指令（标题取自 `source.plugin`） |
| **技能目录** | `.github/skills` 中 `disable-model-invocation` 不为 `true` 的技能 |

顺序固定为 **AGENTS.md 在前，`.github` 指令在后**。

内容变化时**追加**一条新的注入，而不是改写旧的；某个文件消失时会先给一条
`Instructions removed:` 说明，不会静默丢弃。

## 配置

插件行在 [`cordis.patch.yml`](./cordis.patch.yml)，`config` 字段：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `maxBytes` | `65536` | 单次注入的字节预算；超出时先省略、再截断，并在正文里说明丢了多少 |
| `scanSubdirectories` | `1` | cwd 下当作项目根的下探层数（`paths` 里的每个路径同样适用） |
| `instructionDirs` | `['.github/instructions']` | `*.instructions.md` 所在目录 |
| `skillDirs` | `['.github/skills']` | `<name>/SKILL.md` 所在目录 |
| `paths` | `[]` | **工作区之外**的额外项目根，按与 cwd 相同的规则扫描 |

### 在插件页里改路径

`paths` 同时是该插件设置命名空间（`import-vscode-ai-files`）的一个字段，所以可以在
**设置 → 插件 → 插件配置** 里找到本插件那张卡片：逐行增删路径、保存、放弃或恢复默认。
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

> [!IMPORTANT]
> DSH 的 profile patch 层**不热重载**，安装后要**重启 DSH**。
> 装好之后改仓库里的 `.github/**` 是**即时生效**的（每个模型步骤重新读盘），
> 只有改插件自身源码才需要再重启。

卸载：

```sh
dsh plugin --profile desktop remove dsh-import-vscode-ai-files
```

## License

MIT

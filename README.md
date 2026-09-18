# DSH-Import-VSCode-AI-Files

DSH 插件：把一个工作区自带的 **VSCode / Copilot 风格 AI 配置**加载进**每一个** DSH 会话。
同一份 `.github` 配置在 VSCode 和 DSH 里同时生效，不用维护两套。

> [!NOTE]
> 插件只**读取**工作区里的配置，不写任何文件，也不改动 DSH 自身的设置。

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
| `scanSubdirectories` | `1` | cwd 下当作项目根的下探层数 |
| `instructionDirs` | `['.github/instructions']` | `*.instructions.md` 所在目录 |
| `skillDirs` | `['.github/skills']` | `<name>/SKILL.md` 所在目录 |

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

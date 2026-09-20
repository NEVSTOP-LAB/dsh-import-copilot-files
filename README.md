# dsh-import-copilot-files

DSH 插件：把一个工作区自带的 **VSCode / Copilot 风格 AI 配置**加载进**每一个** DSH 会话，
同一份 `.github` 在 VSCode 和 DSH 里同时生效。也可以把**工作区之外**的若干配置目录一起带上，
让一份共享规则喂给所有仓库 —— **默认就带当前用户的 `~/.copilot`**（Copilot CLI 的家目录）。

插件只**读取**配置，不写工作区文件；唯一的写路径是 GUI 里那张改「额外配置目录」的卡片，
落点是 DSH 自己的 `$DSH_HOME/settings.yaml`。

## 功能

| 文件 | 行为 |
| --- | --- |
| `.github/copilot-instructions.md` | 常驻注入，等价 VSCode 的 repo-wide instructions |
| `.github/instructions/**/*.instructions.md` | 按 frontmatter `applyTo` 生效：没有 `applyTo` 的常驻；有的只在本会话**真的碰过**匹配文件之后才注入 |
| `.github/skills/<name>/SKILL.md` | 注册为 DSH 技能：`name` + `description` 进技能目录，正文按需加载 |

`applyTo` 的语法与 VSCode 一致（`**`、`*`、`?`、`{a,b}`、`[abc]`、逗号分隔），相对**该文件所属的
那个根**匹配：cwd 侧是项目根，`paths` 条目侧是条目自身。`SKILL.md` 的
`disable-model-invocation` / `user-invocable` 与 DSH 原生技能同义，省略即允许，拼写非法会让该技能
被跳过并打一条警告。

## 扫描范围

会话 cwd 本身，加上它下面 `scanSubdirectories` 层（默认 1）的直接子目录，各取自己的 `.github/`
（`.github/instructions/` 内部递归到深度 4）；不向上找祖先链。`D:\NEVSTOP-LAB` 这类「多 repo 工作
文件夹」因此成立：文件夹自身和它直接下面的每个 repo 各贡献自己的 `.github`，互不干扰。

`paths` 里的每个路径**本身就是配置目录**（等价于项目根的 `.github`，其下没有 `.github`），
所以 `scanSubdirectories` 不作用于它。路径可绝对、可相对会话 cwd，**或以 `~` 开头表示用户主目录**
（只有开头那个 `~` 有此含义，`~name` 与 `a/~/b` 是普通相对路径；环境变量与通配符不展开）；
不存在的路径贡献为空。默认 `['~/.copilot']`，在插件页里删掉那行并保存成 `paths: []` 即可关闭。

`AGENTS.md` 不由本插件处理：它属于 DSH 核心的 `dsh-agent-instructions`，按 cwd 的祖先链读取。

## 在会话里看到什么

一条标题为「上下文注入」、来源标签为 `import-copilot-files` 的注入行，加上上述配置目录里
`disable-model-invocation` 不为 `true` 的技能。顺序固定为 **AGENTS.md 在前**；内容变化时**追加**
一条新注入，文件消失时先给一条 `Instructions removed:`。

## 配置

插件行在 [`cordis.patch.yml`](./cordis.patch.yml)，`config` 字段：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `maxBytes` | `65536` | 单次注入的字节预算；超出时先省略、再截断，并说明丢了多少 |
| `scanSubdirectories` | `1` | cwd 下当作项目根的下探层数（只作用于 cwd 的走查） |
| `instructionDirs` | `['.github/instructions']` | `*.instructions.md` 所在目录（相对配置目录；`paths` 条目去掉前导 `.github`） |
| `skillDirs` | `['.github/skills']` | `<name>/SKILL.md` 所在目录（同上） |
| `paths` | `['~/.copilot']` | **工作区之外**的配置目录，等价于项目根的 `.github`；条目以 `~` 开头表示用户主目录 |

### 在插件页里改路径

**设置 → 插件 → 插件配置** 里标题为「导入 Copilot 文件」（英文界面 `Import Copilot Files`）的卡片
可以逐行增删 `paths`、保存、放弃或恢复默认；`maxBytes`、`scanSubdirectories`、`instructionDirs`、
`skillDirs` 仍只在组合配置里设。

- 写的是 **DSH 的用户设置文档**（`$DSH_HOME/settings.yaml` 的 `import-copilot-files:` 小节），
  不是工作区文件、热重载；组合配置是这一层的基底，「恢复默认」清掉用户覆盖。保存带草稿开始时的
  revision（期间别处改过会被拒绝并提示重试），保存后以宿主回读确认。
- 「浏览…」按部署**能用的那条路由**取目录（DSH Desktop 用自己的 Windows 选择框，其余组合走宿主
  的原生选择器）；部署没有可用路由时卡片不显示该按钮，路径手填。

## 安装

需要 [dsh CLI](https://github.com/deepseek-ai/deepseek-harness)。`--profile web` 是默认 profile，
桌面版用 `--profile desktop`，其他 profile 换成对应名字。

```sh
dsh plugin --profile desktop add github:NEVSTOP-LAB/dsh-import-copilot-files
dsh plugin --profile desktop add github:NEVSTOP-LAB/dsh-import-copilot-files#<commit-sha>  # 锁定提交
dsh plugin --profile desktop add ./dsh-import-copilot-files-0.1.0.tgz   # 或 Release 附件里的 tarball
dsh --profile desktop --dump-config                                     # 确认组合层里出现这一行
dsh plugin --profile desktop remove dsh-import-copilot-files            # 卸载
```

> [!IMPORTANT]
> profile patch 层**不热重载**，安装后要**重启 DSH**。之后改仓库里的 `.github/**` 或某个 `paths`
> 条目下的文件都**即时生效**（每个模型步骤重新读盘），只有改插件自身源码才需要再重启。

### 安装时那条 peer 依赖警告

`dsh plugin add` 原样转发 pnpm 的输出，profile 里**任何一个**插件漏声明 peer 都会让它出现。
**它说的不是本插件**：本插件的宿主包全部声明为可选 peer。是谁缺什么，在 profile 目录里跑
`cd $DSH_HOME/profiles/<profile> && pnpm peers check` 即可 —— 缺的属于那些包自己，与本插件无关。

## 更多文档

- [Releases](https://github.com/NEVSTOP-LAB/dsh-import-copilot-files/releases) —— tarball 与版本记录
- [CONTRIBUTING.md](./CONTRIBUTING.md) —— 参与开发与提交的流程
- [docs/design.md](./docs/design.md) —— 架构与关键机制、源码结构、已知边界
- [docs/compatibility.md](./docs/compatibility.md) —— 依赖面、DSH 接缝、升级校验清单与验证记录
- [docs/development.md](./docs/development.md) —— 本地检查、测试与手工验证、打包发版
- [docs/pitfalls.md](./docs/pitfalls.md) —— 开发坑
- [CHANGELOG.md](./CHANGELOG.md) —— 每个版本的变更

## License

MIT

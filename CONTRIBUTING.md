# 贡献指南（CONTRIBUTING）

面向维护者与二次开发；用户可见的功能、安装与配置见 [README.md](./README.md)。

## 文档地图

| 文档 | 内容 |
| --- | --- |
| [README.md](./README.md) / [README.en.md](./README.en.md) | 用户可见：功能、安装、配置 |
| [CHANGELOG.md](./CHANGELOG.md) | 每个版本的变更；发布正文的来源 |
| [docs/design.md](./docs/design.md) | 架构与关键机制、源码结构、已知边界 |
| [docs/development.md](./docs/development.md) | 目录结构、本地检查、测试驱动、端到端与卡片的手工验证、打包发版 |
| [docs/compatibility.md](./docs/compatibility.md) | 依赖面、DSH 接缝与升级校验清单、验证记录、未实测清单 |
| [docs/pitfalls.md](./docs/pitfalls.md) | 开发坑：跨平台与测试、插件行为、Windows 上的 git/gh |

## 流程

1. **不在 `main` 上开发**：开始任务后先建 feature 分支并切换（`fix/…`、`feat/…`、`docs/…`）；
   分支名冲突时先确认现有分支是否属于当前任务，否则追加唯一标识。
2. **每个独立的逻辑修改、功能点或错误修复完成后立即提交**。提交前保证 `npm run check`
   全绿——编译或测试失败时先修到通过再提交；受限沙箱里逐个测试文件跑，见
   [docs/development.md §2](./docs/development.md)。
3. `git add` 指定文件，不用 `-A`（避免误暂存临时目录）；提交信息用
   `<type>(<scope>): <摘要>`，正文写清改了什么。
4. **每个阶段（一批提交）后**用 `gh pr status` 检查当前分支是否有关联的 open PR：
   若有关联，用 `gh pr comment` 留言本阶段的背景、内容与关键决策，并用
   `gh pr edit --body-file` 更新 PR 描述。判断评论是否已发布，用
   `gh api repos/{owner}/{repo}/issues/{n}/comments` 查询。
5. **改行为就同步改文档**：用户可见的进 README（中英两份结构保持一致），
   机制、验证方法与坑进 `docs/`。README 与 CONTRIBUTING 只描述当前现状与契约；
   `docs/design.md` 另外记录机制背后的取舍依据。
6. 发版流程见 [docs/development.md §4](./docs/development.md)。

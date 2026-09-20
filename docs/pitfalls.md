# 开发坑

## 1. 跨平台与测试

- **Windows 检出是 CRLF**。`core.autocrlf=true` 下 fixture 在盘上是 CRLF，所以对正文做逐字比较
  的断言要先按 EOL 归一化（`test/index.test.js` 里那条就是），否则 `npm run check` 会在一台机器
  上红、在 CI（ubuntu）上绿。
- **断言里不要写死另一个平台的路径写法**。CI 跑 ubuntu、本机跑 Windows，而 `D:\shared` 在 POSIX
  上**不是**绝对路径 —— 它会被当成相对 cwd 的条目，于是断言变成「开发机绿、CI 红」。要断言
  「绝对条目不被 cwd 影响」，就用 `join(tmpdir(), …)` 现拼一个本平台绝对路径
  （`test/discover.test.js` 的 `~` 用例就是这么写的）。
- **反过来的坑同样存在**：POSIX 上恒真的断言可以在 Windows 上为假。`path.isAbsolute('\\\\server')`
  在 win32 上为 `true`（`\\\\server\\share` 经 `path.resolve` 还会带上尾部分隔符），所以
  `isPortableAbsolute('\\\\server')` 的期望值必须按平台区分，不能写成 `false`。
  只在一个平台成立的行为放进 `{ skip: process.platform !== 'win32' }` 的用例，或让期望值由
  `process.platform` 决定。
- **受限沙箱里 `node --test` 的并行 runner 会 EPERM**（spawn 子进程被 pipe 限制挡住）。逐个文件
  直接跑即可，见 [development.md §2](./development.md)。

## 2. 插件行为

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
- **目录失效不能绑在会话 cwd 上，也不能只认 `.github`**。provider 是全局的、一个实例服务所有
  工作区，所以任何配置变更都要让它失效，而不只是当前会话 cwd 下的；而且 `paths` 条目**自己**
  就是配置目录，路径里没有 `.github` 段 —— 只匹配 `/.github/` 会让共享目录里改技能永远不刷新。
  `touchesConfigDir` 两种形状都认（`index.js`），`test/index.test.js` 各钉一条。
- **`paths` 条目是配置目录，不是项目根**。`instructionDirs` / `skillDirs` 在它上面会去掉前导的
  `.` 段与 `.github` 段（win32 上 `\` 与 `/` 都接受，`custom/rules` 这类自定义目录原样拼接），
  `scanSubdirectories` 不作用于它，它的子目录是内容而不是更多的配置目录；它内部的 `.github`
  树一律不被读取 —— 连 `'.'`、`'./.github'`、`'x/.github/y'`、`''`、`'/'` 这些退化写法也不行
  （fixture 里就放着这样一棵树当负例）。改 `lib/discover.js` 的扫描模型时，cwd 侧与 `paths` 侧
  只在 `rootDir`（`applyTo` 的锚点）上分叉，别让两边的 `.github` 语义漂移；另外两个单位可能
  解析到同一个源文件（`paths` 点名一个已在走查里的目录 + 自定义目录名），发现结果按绝对路径
  去重，别把同一个文件注入两次。
- **`paths` 的默认条目是 `~/.copilot`**（`DEFAULT_PATHS`，`cordis.patch.yml` 与设置 schema 同源）。
  它让每个会话默认带上用户级 Copilot 配置，也让**测试必须自带 home**：`apply` 的
  `options.homeDir` 与 `discover` 的 `homeDir` 是同一个 seam，`test/index.test.js` 的 `mount`
  默认指到一个**不存在**的目录，用例要测默认条目时才指到自己的临时 home。谁把 `discover()`
  的 home 换回 `os.homedir()`，用例就会在「开发机上恰好有 `~/.copilot`」时红、在 CI 上绿。
  显式 `paths: []` 是关闭它、不是缺省，`normalizeSettings` 认这个区别。
- **配置路径只解析一次，且只在 `lib/discover.js`**：`resolveConfiguredPath(cwd, value, home)`
  是唯一的入口（`~` 展开、cwd 相对、cwd 为 `null` 时拒绝相对条目都在它里面），
  `index.js` 的 `touchesConfigDir` 复用它。别在别处再写一份 `resolve()`，
  否则「发现读到的目录」与「改动会让技能目录失效的目录」会漂移。
  只有**开头**的 `~` 是主目录（`~name`、`a/~/b` 是普通相对路径），通配符与环境变量不展开。
- **`disable-model-invocation: true` 会让技能不进目录**。这是既定语义，不是插件 bug；
  想让模型看到就不要写这一行（或写 `false`）。
- **卡片的 slot key 必须等于设置命名空间**。`settings.plugin.item` 是按 namespace 派发的：
  key 写错不会报错，卡片只是永远不出现。host 侧的 `SETTINGS_NAMESPACE`（`index.js`）与
  browser 侧的 `NAMESPACE`（`lib/client.js`）是同一个字符串的两份硬编码，改一个必须改另一个。
- **「浏览…」不能只走一条路由**。win32 的 DSH Desktop profile 禁用了
  `dsh-host-directory-picker-auto`，改挂 `browse` 后端，而 `browse` 没有 `pick` 能力：
  `uiWorkspace.pickDirectory()` 在那里**必然被拒**（`directory-picker/unavailable`）。
  可用的两条路由是 `window.__DSH_DESKTOP_PICK_DIRECTORY__`（Desktop / win32）与
  `uiWorkspace.pickDirectory()`（挂 `native` 后端的组合），两条都在时以前者为准 ——
  否则一次「浏览」会弹两次框。两条都不在时 `hasChooser` 为假，卡片不渲染该按钮；
  选择被拒时要给提示，**不吞掉 rejection**：`void browse().then(...)` 那种写法在按钮上
  表现为「点了没反应」。
- **设置 schema 不能自己写一个「形状像」的对象**。服务本身不检查 schema 的形状，所以手写的
  能通过 host；但浏览器要靠 `schema.toJSON()` 的 `{ uid, refs }` 信封把它重建出来渲染表单，
  重建失败时该 namespace **没有可编辑值**（`decode` 返回 undefined，卡片只能渲染空态），
  而且没有任何报错。这就是 `@deepseek-ai/schemastery` 必须以真身出现的原因。
- **`dsh.client` 声明了就必须有 bundle**。宿主扫描已启用的 Loader 条目并解析
  `exports['./client']`；文件缺失会让客户端激活**大声失败**（不是静默降级）。
  改 `package.json` 的 `exports` 时注意别把 `./client` 弄丢。
- **设置写入是带 revision 的**。卡片提交时带草稿开始那一刻的 revision，被并发改动抢先会被
  拒绝 —— 这是设计（`expectedRevision`），不是失败重试的重试。改卡片时不要图省事改成
  「不带 revision 的 `set`」，那会静默覆盖别人的改动。

## 3. Windows 上的 git / gh

- **git push 可能需要 TLS 兜底**。schannel 在某些环境取不到凭证
  （`SEC_E_NO_CREDENTIALS`，`curl.exe` 同样失败），换 OpenSSL 后端 + 从系统证书库导出的
  CA 即可：`git -c http.sslBackend=openssl -c http.sslCAInfo=<ca.pem> push`。
  - **症状**：`fatal: unable to access 'https://github.com/…': schannel: AcquireCredentialsHandle
    failed: SEC_E_NO_CREDENTIALS (0x8009030E)`。
  - **原因**：本机 TLS 被本地工具箱**中间人**（presented chain 的 issuer 是
    `SteamTools Certificate`）。该根证书装在 Windows 证书 store 里，所以浏览器、`gh`、
    Go 程序都正常，只有走 schannel 的 git 不行。
  - **怎么看出来**：`openssl s_client` 在受限沙箱里**跑不起来**（Cygwin 进程起不来 signal
    pipe，`Win32 error 5`），改用 node 探针（注意 `s` 要先绑定，回调里才拿得到 `s`，
    否则是回调内抛 `ReferenceError`，外面 try/catch 也拦不住）：
    ```js
    import tls from 'node:tls'
    const s = tls.connect(
      { host: 'github.com', port: 443, servername: 'github.com', rejectUnauthorized: false },
      () => { console.log(s.getPeerCertificate(true).issuer) },
    )
    ```
  - **修**：把**拦截方**的根证书导成 PEM 再换后端。用 `-c http.sslCAInfo=<Git 自带
    ca-bundle.crt>` 会得到 `SSL certificate problem: unable to get local issuer certificate`
    —— 那是 CA 选错了，不是网络不通。导出（`Subject` 换成上面看到的 issuer）：
    ```powershell
    $pem = (Get-ChildItem Cert:\CurrentUser\Root, Cert:\LocalMachine\Root |
      Where-Object { $_.Subject -like '*SteamTools*' } | ForEach-Object {
        $b = $_.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
        "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($b, 'InsertLineBreaks') + "`n-----END CERTIFICATE-----"
      }) -join "`n"
    [System.IO.File]::WriteAllText("$env:TEMP\intercept-ca.pem", $pem)
    ```
    然后：`git -c http.sslBackend=openssl -c http.sslCAInfo="$env:TEMP\intercept-ca.pem" push`。
    **别把它写进 `git config`，也别写进仓库里的任何文件** —— CA 路径是本机的，换机器就失效。
- **沙箱里 gh 的 credential helper 起不来**。全局配置里有
  `credential.https://github.com.helper=!'C:\Program Files\GitHub CLI\gh.exe' auth git-credential`，
  受限沙箱下它会以 `error: failed to execute prompt script (exit code 66)` +
  `fatal: could not read Username for 'https://github.com'` 结束 —— 看起来像认证失败，其实是
  那个子进程没起来。绕过：**关掉 helper**，用 `gh auth token` 直接给一次性的授权头
  ```powershell
  $pair = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$(gh auth token)"))
  git -c credential.helper= -c http.extraheader="Authorization: Basic $pair" push
  ```
  token 不要落盘、不要打印；`-c` 只作用于当次命令，不会写进 config。注意 **`$pair` 本身就是
  一份可用凭证**，它会出现在进程命令行里（同用户的进程用 `Win32_Process.CommandLine` 就能看到），
  所以别把它贴进日志、CI 输出或 issue 里。
- **推送被 `GH007` 拒绝＝提交作者邮箱是私密邮箱**。
  `remote: error: GH007: Your push would publish a private email address.` —— 本机全局
  `user.email` 是一个私密地址，而仓库开了 “block command line pushes that expose my email”。
  本仓库历史用的是 noreply 地址，照抄它：
  ```powershell
  git log -3 --format='%an <%ae>'                 # 先看历史用的是哪一种
  git -c user.name=NEVSTOP -c user.email=8196752+nevstop@users.noreply.github.com \
      commit --amend --no-edit --reset-author      # ID 从 gh api user --jq .id 取
  ```
  `--amend` 只重写**顶端**那一个提交；分支上不止一个提交带私密邮箱时它不够，要么
  `git rebase --exec 'git commit --amend --no-edit --reset-author' <base>` 逐个重写，
  要么先在 `git config user.email` 里改成 noreply 再重写整条分支。
  已经推上去过再加这些改写，需要 `--force-with-lease` 重推。

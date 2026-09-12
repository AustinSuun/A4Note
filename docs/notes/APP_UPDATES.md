## 0.1.5 更新入口

桌面：设置 → 软件更新（关于页也有快捷入口）。检查、下载并验证签名、用户确认保存后安装分为独立步骤，不会静默升级或强制退出。

浏览器插件0.6.1：插件弹窗底部“插件设置与更新”。点击时可授予固定GitHub API源的访问权限；检查最新稳定发布，按数字比较版本，再显式下载ZIP。解压加载版无法自动替换自身文件，需要覆盖原目录并在扩展管理页重新加载。浏览器商店自动更新尚未发布，不冒充支持。

# 软件内签名更新与 GitHub 发布

仓库：`https://github.com/AustinSuun/A4Note`。Windows x64 使用 Tauri 2 updater + GitHub Releases，客户端端点固定为 `https://github.com/AustinSuun/A4Note/releases/latest/download/latest.json`。

## 用户操作

- 首次需手动安装0.1.3或之后含更新功能的版本；旧0.1.2没有更新入口，无法追溯增加。
- 设置 → 关于 → 软件更新 → 检查更新 → 下载并验证 → 确认备份后保存并安装。
- 不自动下载或强制更新。下载后由Tauri强制验证签名；保存失败/有冲突时不安装。Windows安装会退出应用；未完成采集任务在后续启动恢复。
- 网络失败明确报错，不冒充“最新版”。支持重新检查/下载；下载中切换设置页不会创建第二个更新任务。退出软件会中止尚未完成的下载。
- 更新说明按纯文本呈现。浏览器开发者模式扩展不在桌面自动更新范围内，需从同一Release下载ZIP重新加载。
- 当前新发布仅支持Windows x64。macOS/Linux更新通道未配置，历史macOS包不代表新版本已支持。
- 更新签名与Windows Authenticode是两回事；更新签名不消除未签名安装器的SmartScreen提示。

## 密钥和备份

- 公钥内嵌 `src-tauri/tauri.conf.json`；私钥**绝不入Git**。
- 初次发布者本机保存在 `%USERPROFILE%\.tauri\A4Note-updater\signing.key`，密码保存在同目录 `password.dpapi`，目录仅当前用户和SYSTEM可访问。
- DPAPI密码文件仅原Windows用户/配置可解密；备份时务必另行安全保管**加密私钥和可恢复的密码**（密码管理器/离线保险库），不能只复制DPAPI文件到其他电脑。不得把私钥或密码贴进Issue、日志或普通仓库文件。
- GitHub Actions Secrets：`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；仅受信任的发布工作流可用。不要在fork/PR中提供这些密钥。
- 丢失私钥会使旧客户端无法接受后续更新；不得随意重新生成/覆盖。更换公钥需设计旧密钥签署的过渡版本。

## 发布流程

1. 同步 `package.json` / `package-lock.json`、`src-tauri/Cargo.toml` / `Cargo.lock`、`tauri.conf.json` 的桌面版本，必须递增。扩展独立版本；禁止改写已公开的旧版更新包。
2. 本机执行 `npm run package:windows`（自动读取上述仓库外密钥或显式环境变量），再执行 `node scripts/package-capture-extension.mjs`。不执行安装器或测试。
3. 标准脚本隔离构建并归档旧latest，输出安装器、`.sig`、`latest.json` 和 `build-info.json`。`latest.json`中签名是文件内容，不是路径。
4. 提交源码并推送，随后 `node scripts/publish-release.mjs`。脚本先核对版本、签名清单和产物哈希，创建草稿，上传全部必需资产后才公开。已公开版本拒绝覆盖；失败草稿可在同一源码提交重试。
5. 也可推送匹配的 `vX.Y.Z` tag 或手动运行Release工作流，由Windows runner进行同样的构建和发布；GitHub Secrets须已配置。不要同时执行本地发布与CI发布同一版本。
6. 发布源码提交应对应实际构建输入。首个签名版本仍需由用户手动安装。构建/哈希通过不是端到端更新验收；首次真实升级应使用资料副本人工确认。

`CI`工作流仍包含历史测试；需要遵守“不运行测试”的单次提交时，在提交消息加入 `[skip ci]`，并本地构建发布，不触发普通CI。不要为了当前请求删除项目测试。

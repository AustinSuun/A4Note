# Windows 0.1.31 打包交付（星序）

更新时间：2026-09-23T18:11:40.344Z

## 范围和构建基线

用户明确要求“打包一下exe”。本轮只进行本地 Windows 打包和产物校验，不安装、不运行新 EXE、不关闭用户正在使用的程序、不操作正式资料库，不推送、创建远程 Release 或触发发布 CI。

- 版本：**0.1.31 / windows-x64**，按已有打包版本惯例从 0.1.30 递增。
- 固定源码提交：`71b09a805c8a59ccb7ddbaeecdd45225caa90f22`；产品基线为当时最新 main `ef31ab061c766e032194605cfc445da45eefe06c`。
- 该基线已包含页码任务交付 `7015ef6`、存储位置功能、已合并的菜单/侧栏精简与列设置缩放定位修复，以及之前的目录/托管图片等改动。未混入其他未合并分支；构建开始后的主线提交不自动进入这个固定快照。
- 独立工作区：`D:/WorkSpace/Aster/.worktrees/windows-package-xingxu-0131`；分支 `chore/windows-package-xingxu-0131`。未切换或清理别人正在使用的根工作区。
- `package.json`、`package-lock.json` 两处根版本、Cargo.toml、Cargo.lock 和 tauri.conf.json 的桌面版本保持一致；发布说明文本同步，但没有运行发布工作流。
- `builtAt`：`2026-09-23T18:11:37.969Z`；`build-info.json` 的 `sourceDirty`：**true**。本轮开始构建时工作树干净。Tauri 构建时改动 Cargo.toml 和两份 schema 的换行，因此元数据如实保留 sourceDirty=true；事后只恢复经对比确认的换行差异，没有篡改元数据为 false。

## 交付文件

统一位于 `D:/WorkSpace/Aster/artifacts/windows/latest/`：

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `a4note.exe` | 38494720 | `C7D7D0C4741804732F7B3190827B736420CFDB4799062D407013DF55180DA26E` |
| `A4 Note_x64-setup.exe` | 23087148 | `2D6B9CFFB3DD3C4DB3C9DA7C1899C195B8A7DE58F487E8669B56B7841BDF6546` |

另保留 `build-info.json`、`A4 Note_x64-setup.exe.sig` 和 `latest.json`。`latest.json` 内 GitHub URL 是标准脚本生成的发布目标，不代表已经创建远程 0.1.31 Release。

上一份 **0.1.30** 的整个 latest 目录已按标准流程归档到：

`D:/WorkSpace/Aster/artifacts/windows/archive/0.1.31-20260924-020627-26012`

归档路径前缀按新打包版本命名；其内部原 build-info 仍是旧版 0.1.30，没有冒称旧文件为新版本。归档中 5 个原文件的 SHA-256 与构建前逐项一致。

## 构建和校验

- 标准命令：`npm run package:windows`，由 PowerShell 执行；退出 **0**，构建命令耗时 **312.103 秒**。
- 桥命令：`cmd_8005a4db89fee986718e770b1c49e139cbbf443baa285c3d`（还包含版本提交、main 快进与独立校验；此处耗时仅指其中的打包命令）。
- 原生 host、TypeScript/Vite、Rust release 和 NSIS 安装包构建成功。标准脚本使用独立前端和 Cargo 输出，构建完成后清理自身临时构建目录；产物目录通过专用 worktree 的 artifacts junction 指向仓库的规范交付位置。
- 标准脚本确认实际 EXE 中包含构建入口资源，浮动工具坞构建 CSS 校验通过。
- 独立重新读取两个最终文件计算 SHA-256，与 build-info 完全一致。
- Windows EXE 版本资源：FileVersion `0.1.31`、ProductVersion `0.1.31`。
- `.sig` 与 `latest.json` 签名文本一致；使用配置中固定的公开密钥，按 Minisign 格式对安装包的 BLAKE2b 摘要及可信注释分别执行 **Ed25519 密码学验签，均通过**。没有输出或复制签名私钥/密码。
- 更新器签名不是 Windows Authenticode 代码证书；本轮不将二者混称。
- 对 960 个已跟踪文件建立构建前 SHA-256，构建后逐项相同。仅恢复经规范化文本比较证明为自身构建换行变化的文件：`src-tauri/Cargo.toml`, `src-tauri/gen/schemas/desktop-schema.json`, `src-tauri/gen/schemas/windows-schema.json`；未覆盖其他 Agent 修改。
- 编译警告按构建日志保留，没有为消除无关警告修改业务代码。

## 未测范围与下一步

本轮未运行完整 `npm run verify`，未安装或启动这个新包做 GUI 验收；构建和签名通过不等于全部功能已经人工验收。功能验证历史以对应任务报告为准，页码任务仍由用户最终检查。用户可自行选择直接 EXE 或安装包，重要资料建议先备份。

机器记录位于该独立工作区 `.tmp/package-xingxu/`：`package.log`、`before.json`、`verification.json`。本报告和配对状态是构建后记录，不改变已生成产物的源码提交或哈希。

# Windows EXE 打包交付（Arena）

更新时间：2026-09-22T18:16:00+08:00

## 范围与基线

用户指示「代码合并了，直接打包一下」——对当前已合并的本地 `main` 打一份 Windows 安装包。本轮不合并任何未完成分支、不安装、不启动新产物、不推送或公开发布、不触碰正式资料库，也不重启共享任务服务。

- 版本：**0.1.28 / windows-x64**。
- 构建基线：`76a6cb2bffc7bf0f9692e60c93f317264a8a074a`（`chore: release 0.1.28`），其父提交为合并后的 `38d9977`。
- 生成时间：`2026-09-22T10:08:22.731Z`（本地 18:08:22）。
- `sourceDirty: true`：主工作区原有未跟踪文件（`2505.13447v1.pdf`、`docs/pdf_test/`、`docs/screenshots/*.png`、`nul`）在打包前后保持不变；**已跟踪源码零改动**（与上一轮不同，本轮构建未改动 `src-tauri/Cargo.toml` 换行符）。

### 版本决策

`0.1.27` 已经发布并在用，主分支自那之后合入了标注图层弹窗优化、橡皮擦缩放对齐、快捷键提示、标注色板与文本层定位等多项改动；若不递增版本，更新清单 `latest.json` 无法让已安装的 0.1.27 收到更新，归档目录也会出现两个同前缀条目。因此按仓库既有约定（`chore: release 0.1.26`、`chore: release 0.1.27`）递增补丁号到 **0.1.28**，改动与上一轮一致的四份文件：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`（各 1 行）。

## 产物

全部位于 `D:/WorkSpace/Aster/artifacts/windows/latest/`。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `artifacts/windows/latest/a4note.exe` | 37687296 | `20FB3F6DC851A27B65E680A3CC50E5F051F89E87E203A98EEC021AF18B567CF7` |
| `artifacts/windows/latest/A4 Note_x64-setup.exe` | 22831212 | `FA5A1EE17FBE24E9CEECC1D99826D01E7AF174D1D5300BF09752DA6F8381BB29` |

配套 `build-info.json`（`version 0.1.28`、`builtAt 2026-09-22T10:08:22.731Z`、`updaterSigned true`、native host 与扩展版本 `0.6.5`）、`A4 Note_x64-setup.exe.sig` 与 `latest.json`。更新说明按本次合并撰写：标注图层弹窗优化（整行选中态、清晰的新图层按钮、逐层删除与删除确认、工具坞入口固定宽度）、橡皮擦预览与缩放对齐修复，并合入快捷键提示、标注色板与文本层定位等阅读器改进。

上一份 latest（0.1.27 产物）由标准脚本归档至 `artifacts/windows/archive/0.1.28-20260922-180501-20328`（归档目录前缀按本次版本命名，不代表归档内旧包版本）。

## 构建与核验

- 命令：`npm run package:windows`，退出 0，耗时约 202 秒（18:05:01 → 18:08:23 本地）。日志 `.tmp/arena-mcp/package.log`。
- 标准脚本自身核验通过：原生宿主产物、TypeScript/Vite 前端、Rust release 与 NSIS 安装包均构建成功；`Verified 5 frontend entry assets inside the executable`；浮动工具坞 CSS 校验通过；更新签名非空。
- 独立复核（本轮重算）：
  - 两份产物的 SHA-256 与 `build-info.json` 逐字节一致；
  - `.sig` 文本与 `latest.json` 的 `signature` 完全一致；
  - 从打包提交重新执行前端构建，产物含本轮功能的标记 `annotation-layer-delete`（2 个 chunk）、`data-layer-confirm-move`（1 个）、`annotation-layer-row`（2 个），说明包内前端确为合并后的代码；exe 内嵌资源是压缩存储，**不能**用 exe 字符串搜索证明这一点，故用上述方式代替。
- 未单独做密码学验签或 Windows Authenticode 身份验证，不混称证书签名。

## 过程记录（含一次失败尝试）

首次打包由工具前台会话启动，编译中途收到 `STATUS_CONTROL_C_EXIT (0xc000013a)`——父会话结束时进程树被一并终止。已改用独立进程方式（`Start-Process` 隐藏窗口运行 `run-package.cmd`）重新启动，构建成功；失败那次留下的 784 MB 半成品目录 `.build/tauri-packaging/20260922-180025-5308` 已删除，未影响产物。打包脚本每次使用独立的 `.build/tauri-packaging/<runId>/target` 与独立前端输出目录，因此重跑不与其它 Agent 的构建共享状态。

## 限制与未做

- 本轮未运行完整 `npm run verify`，也未做安装/GUI 实测；构建成功不等同于功能验收。本轮所含功能在合并前已单独验证（图层弹窗契约 43/43、原生 dev:live 12/13 且唯一失败为 dev favicon 404）。
- 未安装、未启动产物、未推送、未发布；产物就地保留在 `artifacts/windows/latest/`，等待用户取用。
- 编译期仍有 unused/dead-code 与前端分包警告，未为打包修改业务代码。

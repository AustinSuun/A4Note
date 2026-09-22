# Windows EXE 打包交付（星序）

更新时间：2026-09-22T08:40:08+08:00

## 范围与基线

用户授权打包 EXE。本轮仅打包当前 main，不合并未完成分支，不安装、不启动新产物、不关闭用户程序、不触碰正式资料库，不推送/公开发布或重启共享服务。

- 版本：**0.1.27 / windows-x64**。
- 构建基线：`4b4078814bbf4d2cd20123086b0d4273086f1412`；打包前后 HEAD 一致。
- 生成时间：`2026-09-22T00:37:26.577Z`（本地 2026-09-22 08:37:26）。
- `sourceDirty: true`：主工作区原有未跟踪 PDF/截图等保留，构建工具也曾改变 Cargo.toml 换行符；不能称完全干净的可复现提交构建。
- 原有橡皮擦回归修复已在 main；色板/弹窗任务 `23528921` 仍 queued，图层精简 `e5e73f0f` 与快捷键 `9230f8ce` 在核对时仍进行中，不宣称本包包含这些未交付需求。

## 产物

全部位于 `D:/WorkSpace/Aster/artifacts/windows/latest/`。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `artifacts/windows/latest/a4note.exe` | 37679104 | `540773B27F22F050B9C8D954CEEEEE6D3006F2A506DD066817D451D96397E996` |
| `artifacts/windows/latest/A4 Note_x64-setup.exe` | 22817032 | `96BCEB6822F88557FC923DA4212F59EC05C1A7D2D713D4222536556856729D3C` |

配套保留 `build-info.json`、`A4 Note_x64-setup.exe.sig` 和 `latest.json`。更新签名存在且清单一致；本轮未单独做密码学验签或 Windows Authenticode 身份验证，不混称证书签名。

上一份 latest（元数据为 0.1.26）由标准脚本归档至 `artifacts/windows/archive/0.1.27-20260922-083222-28136`；归档目录前缀按本次版本 0.1.27 命名，不代表归档内旧包版本。

## 构建与核验

- 命令：`npm run package:windows`。
- 桥命令：`cmd_224afb74e6d0e2686db11c263b9a286c6be49f3d893ca78a`，退出 0，耗时 308.491 秒。
- 原生 host、TypeScript/Vite 前端、Rust release 与 NSIS 安装包均构建成功；隔离前端/Cargo产物避免共用 dist。
- 标准脚本验证 EXE 内 5 项前端入口资源及浮动工具坞 CSS；更新签名非空。
- 两份最终产物独立 SHA-256 与 `build-info.json` 完全一致；`.sig` 与 `latest.json` 签名文本一致。
- 已对构建相关已跟踪源码建立逐文件哈希。唯一字节变化为 `src-tauri/Cargo.toml` 换行符，经核对 HEAD 文本一致、候选原始字节哈希等于构建前哈希后，仅恢复该文件原始字节；恢复后全部源文件哈希一致，未覆盖其他 Agent 内容。
- 未运行完整 `npm run verify` 或 GUI/安装测试；构建成功不等同于功能验收。编译存在 unused/dead-code 和前端分包等警告，未为打包修改业务代码。

日志与机器记录（不进入 docs）：`.tmp/package-xingxu-20260922/package.log`、`before.json`、`verification.json`。本次记录及双状态文件在打包后更新，不改变已生成产物。

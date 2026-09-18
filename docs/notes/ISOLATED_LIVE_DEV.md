# 独立源码热更新开发版（Windows）

## 启动

在当前集成工作区打开 PowerShell：

```powershell
Set-Location D:\WorkSpace\Aster
npm run dev:live -- --plan  # 只查看隔离配置，不写文件、不启动
npm run test:dev-live
npm run dev:live
```

首次 Rust 调试编译较慢。窗口左下角显示 `DEV · integration · 独立测试库`，原生窗口标题也带 DEV。保留原有正式/临时预览窗口；不要把两个窗口混用。

此入口直接使用当前工作区源码，包括已有未提交改动，不会创建遗漏这些改动的新 worktree，也不会替你提交 Git。

## 隔离边界

- identifier 为 `app.aster.research.dev.<instance>.w<工作区路径哈希>`，不同工作区/实例与正式 `app.aster.research` 分开。
- 资料库由 Tauri 的 appDataDir 派生到该 identifier 下的 `AsterData`，首次仅初始化默认指南；不会复制正式库、笔记、登录信息或配置。
- WebView profile 位于 `.tmp/live-dev/<instance>/webview`，由子进程环境变量指定；Tauri 窗口另有 `dataDirectory: live-webview`。实际使用路径应通过 WebView 进程命令行核实，不能只相信配置。
- 默认 Vite `127.0.0.1:1421`，CDP `127.0.0.1:9230`。启动先检查端口，不自动换端口或关闭占用者。调试端口仅供本机开发，不应对外转发。
- Native Messaging 管道本来按 Windows 用户共用，因此隔离 debug identifier 会在创建采集数据库/监听管道之前跳过整个采集服务。此窗口不能验收浏览器采集；release 构建行为不变。
- updater endpoints 置空，开发窗口不从正式更新地址获取安装包。
- Rust 输出在 `.build/live-dev/<instance>/target`；运行配置、归属锁和状态在 `.tmp/live-dev/<instance>`，不改生产 Tauri 配置或已交付安装包。
- 这是默认数据路径隔离，不是操作系统沙箱。**不要在开发窗口手动打开真实笔记目录、导入真实资料、恢复正式备份或登录真实账户。** 原生文件对话框仍能访问用户主动选择的文件。

## 日常修改与验证

1. 先按 `LIVE_MULTI_AGENT_WORKFLOW.md` 认领文件；唯一操作者管理这个集成窗口。
2. 修改 `src/` 中实际 CSS/React/TS 源码并保存，Vite 自动热更新；React Fast Refresh 对不适合保留状态的模块可能刷新页面。
3. Rust 源码变化由 `tauri dev` 编译并重启**开发实例**，不是前端 HMR；重启前先保存测试数据。
4. 修改启动脚本、环境变量或生成配置需要停止后重新启动此实例。
5. CDP 临时注入仅是诊断；有效改动必须写回产品源码。开发徽标与 HMR 探针仅由开发 Vite 插件注入，不进入生产构建。
6. 正式交付仍需源码测试、生产构建、独立打包与安装版本验收。看到开发窗口变化不代表安装包已经更新。

## 停止和再次启动

在**启动此实例的终端**按 Ctrl+C；脚本仅清理自己仍持有的 Tauri 子进程树并关闭自己的 Vite 服务，不按进程名批量杀进程。先保存开发测试内容。正常退出会移除 owner.lock.json，保留测试数据/profile供下次继续使用。

如果机器断电或终端被强制关闭而遗留锁，先读取 `.tmp/live-dev/integration/owner.lock.json` 和 `session.json`，检查其中 PID、命令行、路径及端口是否仍属于该实例；确认全部停止后才可手动移除陈旧锁。不要直接删除整个目录，也不要因为超时而关闭其他窗口。

需要另一个实例时，必须先协调文件/窗口所有权，并显式使用其他端口：

```powershell
npm run dev:live -- --instance reader --port 1422 --cdp-port 9231
```

## 维护检查

```powershell
npm run test:dev-live
npm run build
npm run test:architecture
npm run test:agent-status
```

`test:dev-live` 验证身份、目录、端口约束及配置合并，不等于原生运行验收。运行验收还应核对页面 URL/DEV 身份、`get_aster_paths` 返回的实际路径、采集禁用状态、WebView profile 与监听地址，并通过保存 CSS 文件确认无需页面重载的 HMR。测试探针为 `.tmp/live-dev/<instance>/hmr-probe.css`，不修改用户笔记。

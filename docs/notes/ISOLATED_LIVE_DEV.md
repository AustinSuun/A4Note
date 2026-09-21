# 独立源码热更新开发版（Windows）

## 启动

在当前集成工作区打开 PowerShell：

```powershell
Set-Location D:\WorkSpace\Aster
npm run dev:live -- --plan  # 只查看隔离配置，不写文件、不启动
npm run test:dev-live
npm run dev:live
```

首次 Rust 调试编译较慢。窗口底部有一条环境状态条，原生窗口标题为 `A4 Note DEV · <instance>`。**只有状态条读作 `DEV <instance> · 独立测试库（原生已核验 …）` 时，这个窗口才是经过核验的独立实例**；红色状态条表示原生侧拒绝了资料库访问，此时不要继续测试、不要把截图当作验收证据。保留原有正式/临时预览窗口；不要把两个窗口混用。

此入口直接使用当前工作区源码，包括已有未提交改动，不会创建遗漏这些改动的新 worktree，也不会替你提交 Git。

## 环境状态条与门禁（前后端双向核验）

状态条由产品模块 `src/platform/devEnvironmentStrip.ts` 在 `src/main.tsx` 里于 React 挂载前安装（不依赖任何产品模块），因此 `npm run dev` / `dev:live` 的 Vite 页面和 `tauri build --debug` 的静态调试包显示的是同一条状态条；`dev:live` 通过 Vite `define` 把启动器身份交给它以检测前后端串用，普通 `npm run dev` 是通用 `preview` 身份。release 构建（安装包）拿到原生 `release` 裁定后不渲染任何东西（`npm run test:dev-environment-browser` 断言）。它自己不断言任何隔离结论，而是调用原生命令 `get_dev_environment`（`src-tauri/src/dev_environment.rs`）取运行时裁定：

| 状态条 | 含义 | 何时出现 |
| --- | --- | --- |
| `DEV <instance> · 独立测试库（原生已核验 <身份>/AsterData）· <identifier>` | 原生侧核验通过：debug 构建、身份为 `app.aster.research.dev.<instance>.w<hash>`、实际资料库目录 = 启动器登记的目录、WebView profile = 启动器登记的目录、路径无 `..`/符号链接/联接点 | `npm run dev:live` 正常启动 |
| `DEV <instance> · 浏览器预览 · 无原生资料库` | 普通浏览器打开 Vite 页面，没有 Tauri，也没有任何资料库 | `npm run dev` 或任何浏览器夹具 |
| 同上绿色状态条，但窗口标题/URL 不是 Vite | `tauri build --debug --no-bundle --config <隔离配置>` 构建、由自动化驱动启动的静态调试包：驱动必须像 dev:live 一样传入 `A4NOTE_DEV_EXPECTED_ID/ROOT/PROFILE` 与 `WEBVIEW2_USER_DATA_FOLDER`（ROOT = `%APPDATA%\\<identifier>\\AsterData`，可用隔离的 APPDATA）；缺少即为红色 `缺少 A4NOTE_DEV_EXPECTED_ID` 并拒绝资料库 | 原生自动化验收（截图必须带此状态条才算隔离实例） |
| 红色 `DEV … · 已阻止资料库访问 · <原因>` | 原生侧拒绝：所有资料库命令返回错误，页面置为 inert | `npm run tauri:dev`（调试构建 + 正式身份，见下）、身份/目录/profile 与启动器登记不一致、缺少启动器环境变量、路径不安全 |
| 红色 `DEV … · 前端实例 X 与原生身份 Y 不一致` | 页面由实例 X 的 Vite 提供，但原生身份是 Y | 端口/配置串用 |
| 橙色 `DEV·正式库 正式资料库 · 已按 A4NOTE_ALLOW_PRODUCTION_LIBRARY 明确放行` | 开发者本人显式放行调试构建使用正式库；**不是隔离测试环境，Agent 测试禁止** | 手动设置了 `A4NOTE_ALLOW_PRODUCTION_LIBRARY=1` 的 `npm run tauri:dev` |

门禁细节：

- 启动器在创建任何目录之前先做准入（`scripts/dev-live-admission.mjs`）：`APPDATA` 必须存在且为绝对路径；身份必须匹配 `app.aster.research.dev.<instance>.w<10 位十六进制>`；资料库目录、状态目录、profile 都不得与正式库 `%APPDATA%\app.aster.research\AsterData` 相同或互相包含，不得经过符号链接/联接点；当前 shell 不得已经设置 `A4NOTE_DEV_EXPECTED_*` 或 `A4NOTE_ALLOW_PRODUCTION_LIBRARY`。通过后把 `A4NOTE_DEV_EXPECTED_ID/ROOT/PROFILE` 传给 Tauri 子进程。
- 原生侧在 `setup` 里只计算一次裁定；被阻止的进程不做中断恢复、不启动采集、不打开 SQLite；`library_access::operation()/maintenance()` 对每个命令都先检查裁定，因此不是"前端不显示"，而是后端拒绝。`get_dev_environment` 故意不经过这道门，以便窗口能解释原因。
- release 构建（安装包）永远是 `release` 模式：没有状态条、不阻止、不加 DEV 标签。安装版验收本身没有数据隔离机制，需另建证据来源（见任务报告）。
- `npm run tauri:dev`（正式身份的调试构建）默认被阻止；开发者本人确需在调试构建中打开正式库时，在启动的 shell 里设置 `A4NOTE_ALLOW_PRODUCTION_LIBRARY=1`。该变量对独立实例是冲突项，启动器会拒绝。
- 设置页诊断面板显示真实运行时 `identifier`/产品名（此前硬编码为正式身份）。
- 静态调试包没有 Vite，也没有启动器准入，因此“没有状态条”不再可能：要么绿色（驱动传对了三项期望）、要么红色（缺少/不一致），截图里看不到状态条只剩两种解释——release 安装包，或截图裁掉了底部 28px。

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

```powershell
npm run test:dev-admission            # 准入门禁 + 状态条插件契约（真实临时目录、联接点、独占锁、哨兵正式目录）
npm run test:dev-environment-browser  # 隔离 Chrome 中状态条各状态/布局回归（mock 原生裁定，不是隔离证明）
cargo test --manifest-path src-tauri/Cargo.toml dev_environment   # 原生裁定单测（合成目录，正式哨兵目录零写入）
```

`test:dev-live` 验证身份、目录、端口约束及配置合并，不等于原生运行验收。运行验收还应核对状态条为绿色"独立测试库（原生已核验 …）"、`get_dev_environment` 的 `mode === 'isolated'`、`get_aster_paths` 返回的实际路径、采集禁用状态、WebView profile 与监听地址，并通过保存 CSS 文件确认无需页面重载的 HMR。测试探针为 `.tmp/live-dev/<instance>/hmr-probe.css`，不修改用户笔记。

# Agent 测试环境一致性：DEV 标识、独立测试库与启动入口对齐（56a57eef）— Arena 2026-09-21

任务：`56a57eef-e897-4b89-8517-72d397f2ae25`（青鉴UI派发，用户要求）。执行者：Arena状态核查，接续青帆在 `.worktrees/task-dev-env-badge`（分支 `feature/dev-env-identity-gates`）留下的未提交工作（青帆 12:46Z 领取、13:57Z 被用户交还，工作区无人认领）。结果：分支已合并最新 main（5923514）并提交；未安装、未发布、未重启 4319、未接管任何他人窗口。

## 1. 结论先行

| 分类 | 内容 |
| --- | --- |
| 已确认问题 | ① 左下角/底部 `DEV … 独立测试库` 徽标原本由 `npm run dev:live` 的 Vite **serve 插件**注入，`tauri build --debug` 静态调试包（青澄、Arena 的原生自动化验收实例）和任何非 Vite 入口根本没有它——这就是"有的截图有、有的没有"的直接原因，与是否真的隔离无关。② `npm run tauri:dev`（调试构建 + 正式身份）直接打开正式资料库，且没有任何标识。③ 窗口标题写死 `独立测试库`，未经运行时核验就宣称隔离。④ 设置页诊断面板把 identifier/产品名硬编码为正式值。 |
| 正常不同 | 生产安装包（0.1.24 等 release 构建）没有 DEV 标识是正确的，不应强加；浏览器夹具（Chrome + 合成服务）没有原生资料库，只能显示"浏览器预览"，不能当隔离/持久化验收。 |
| 尚无证据 | 历史截图逐张对应到具体入口未回溯；按本轮结论，凡没有状态条且不是 release 安装包的截图，只能来自静态调试包或裁掉了底部 28px。 |

## 2. 入口矩阵（修复后）

| 入口 | 身份 / 数据目录 | 标识 | 数据隔离事实 |
| --- | --- | --- | --- |
| `npm run dev`（Vite，浏览器） | 无 Tauri，无资料库 | `DEV preview · 浏览器预览 · 无原生资料库` | 不是隔离验收入口 |
| `npm run dev:live -- --instance X`（推荐 Agent 入口） | `app.aster.research.dev.X.w<hash>` → `%APPDATA%\<identifier>\AsterData` | 绿色 `DEV X · 独立测试库（原生已核验 <identifier>/AsterData）· <identifier>` | 启动器准入 + 原生复核（身份/目录/profile 三项一致，路径无 `..`/联接点）|
| `tauri build --debug --no-bundle --config <隔离配置>` + 自动化驱动 | 同上，由驱动传 `A4NOTE_DEV_EXPECTED_ID/ROOT/PROFILE` + `WEBVIEW2_USER_DATA_FOLDER` | 同上绿色；缺少/不一致 → 红色 `已阻止资料库访问 · <原因>` 且资料库命令拒绝 | 修复前：无标识、无门禁 |
| `npm run tauri:dev`（调试构建，正式身份） | `app.aster.research` → 正式库 | 默认红色阻止；`A4NOTE_ALLOW_PRODUCTION_LIBRARY=1` 放行后橙色 `DEV·正式库 正式资料库 · 已明确放行 · 非隔离测试环境` | 修复前静默使用正式库 |
| 生产安装包（release） | 正式身份 | 无标识（原生返回 `release`，不渲染、不阻止） | 无隔离机制，安装版验收需另建证据 |
| 浏览器夹具 / 生产 bundle 在浏览器中 | 无 Tauri | Vite 下"浏览器预览"，静态 bundle 无 | 正常不同 |

## 3. 实现（在青帆设计上完成并修正）

- 原生裁定 `src-tauri/src/dev_environment.rs`（青帆）：`setup` 里一次性计算 `release / isolated / blocked / production-debug`；`library_access::operation()/maintenance()` 对每个命令先检查裁定，被阻止的进程不做中断恢复、不启动采集、不打开 SQLite；`get_dev_environment` 不经过门以便解释原因；`diagnostics.rs` 报告真实 identifier。8 项单元测试。
- 启动器准入 `scripts/dev-live-admission.mjs`（青帆）：`APPDATA` 绝对路径、身份形状、与正式库不相同不互含、无联接点、shell 无残留期望变量与放行变量、独占锁；通过后把三项期望交给 Tauri 子进程。
- 状态条改为产品模块 `src/platform/devEnvironmentStrip.ts`（本轮）：在 `src/main.tsx` React 挂载前安装、零依赖；Vite 页面与静态调试包同一条状态条；`dev:live` 通过 Vite `define` 交付启动器身份以检测前后端串用；release 裁定不渲染任何东西；阻止/串用/IPC 失败时页面置 inert。删除了青帆的 serve 插件与 `vite.config.ts` 改动。
- `lib.rs` 压缩到 159 行以满足架构守卫；文档 `README.md`、`docs/notes/ISOLATED_LIVE_DEV.md` 写明入口、状态条语义、静态调试包必须传的环境变量。
- 回归：`test:dev-admission`（43 项：真实临时目录、哨兵正式目录零写入、联接点、独占锁、状态条/原生源码契约）、`test:dev-environment-browser`（32 项：隔离 Chrome 中所有状态与 1280/800/360 宽布局保留、release 不渲染、静态 bundle 仍显示/阻止）、`cargo test dev_environment`（8）、`test:dev-live`；`verify-all` 已接入前两项之一（admission）与 dev-live。

## 4. 原生实测（Windows，静态调试包，隔离 home，54/54）

用本分支 `npm run build` + `tauri build --debug --no-bundle` 构建三份二进制（`.tmp/arena-env/bin-*`），驱动 `.tmp/arena-env/native-env.mjs`：

| 场景 | 结果 |
| --- | --- |
| A：`arena-env-a` + 三项期望 | `isolated`；绿色状态条含 `独立测试库`/`原生已核验`/identifier；`get_aster_paths` 根在 `<identifier>\AsterData`；通过应用 `create_folder` 写入标记；状态条高 28px，`#root` 在其上方，无任何控件被遮挡（1280×820、980×680 最小窗口、切到阅读场景后均如此）|
| B：`arena-env-b` 同上 | 同上；A/B 根目录不同，B 看不到 A 的文件夹（反之亦然）|
| A 缺少期望变量 | `blocked / missing-expected-identity`：红色状态条带原因与 `npm run dev:live` 指引，页面 inert，`get_aster_paths`/`create_folder` 被拒绝（`DEV 隔离校验失败（…）`），未创建 AsterData |
| A 期望目录指向别处 | `blocked / root-mismatch`，同上 |
| 正式身份调试包（隔离的假 APPDATA） | `blocked / production-library-in-debug`，同上 |
| 正式身份调试包 + `A4NOTE_ALLOW_PRODUCTION_LIBRARY=1` | `production-debug`：橙色 `正式资料库 · 已明确放行`，不含"独立测试库"，资料库命令可用 |

裁定 JSON 与状态条文字均不含用户目录。截图：`evidence/*-default.png`、`*-980x680.png`、`*-reader-scene.png`、`*-desktop.png`（真实桌面区域截图）。

`npm run dev:live` 入口：见第 6 节。

## 5. 未覆盖 / 如实说明

- 没有回溯历史截图到具体入口；结论基于源码与本轮实测。
- 生产 release 构建未重新编译验证"不渲染"（靠 `release` 裁定的单元测试与浏览器 mock 断言）；用户安装版 0.1.24 早于本改动，不含状态条/门禁。
- 门禁只覆盖经 `library_access` 的资料库命令与 setup 中的恢复/采集；不经过该门的非资料库命令（项目文件、任务服务）不受影响，属既有边界。
- 静态调试包的启动约定（三项期望变量）需要各 Agent 的自动化驱动跟进；未改任何他人现有驱动。
- 未合并 main、未推送、未打包安装。

## 6. dev:live 运行时核验

在本 worktree 执行 `npm run dev:live -- --instance arena-live --port 1461 --cdp-port 9281`（启动器准入通过，三项期望写入 session.json 并传给 Tauri 子进程，冷编译约 1 分钟），再用 `scripts/verify-dev-live-runtime.mjs --cdp-port 9281 --expect-instance arena-live` 经 CDP 核验：**21/21 通过**——状态条 `DEV arena-live · 独立测试库（原生已核验 app.aster.research.dev.arena-live.w6d110b74f1/AsterData）· <identifier>`，`get_dev_environment.mode === 'isolated'`，资料库根在 `<identifier>\AsterData`、不是正式目录，裁定不含用户目录；证据 `.tmp/arena-env/evidence/devlive/`。随后用中断信号停止启动器：session `stopped`、锁已移除、无残留 a4note/Vite/CDP。首次启动时应用曾无输出地以退出码 1 结束（未捕获到原因），第二次启动正常；如复现请保留 `.tmp/arena-env/devlive.log`。

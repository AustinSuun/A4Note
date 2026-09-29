# Doc2X 翻译集成：可行性结论与适配层落地（qiuxu，2026-09-28）

任务：`c889e6ad-fdb9-415c-89ca-383e61197203`（rev3 进行中）
分支：`feat/doc2x-translate-qiuxu`（worktree `.worktrees/doc2x-translate-qiuxu`，基线 `b008046`）

## 1. 结论

**可以集成，成本中等，且与"用户登录自己的 Doc2X 账号"的诉求天然吻合。**

- CLI 是普通 npm 可执行文件（`@noedgeai-org/doc2x-cli`，要求 Node.js ≥ 22），以子进程方式调用即可，
  参数、`--json` 输出、`--receipt` 回执和退出码语义都很规矩，不需要逆向任何私有协议。
- 登录走 OAuth 2.0 + PKCE，回调发生在本机随机 127.0.0.1 端口；令牌由 CLI 自存于
  `%APPDATA%/doc2x/cli-oauth-tokens.json`。**我们的软件不读取、不复制、不上传该文件**，
  只调用 `doc2x login/logout/account status`，因此不会碰到用户凭据。
- 主要成本在：长任务与登录需要异步执行层（现有 `run_project_command` 同步且无超时）、
  译文要作为文献衍生文件登记回同一篇文献、设置 UI 需要按 CLI 实际参数逐一适配。

## 2. 能力核对（来源：NoEdgeAI/doc2x-cli-skills，2026-09-28 复读）

| 能力 | CLI 形式 | 备注 |
| --- | --- | --- |
| 登录 | `doc2x login`（`--no-browser` 仅打印地址） | 必须在运行 CLI 的电脑上完成授权 |
| 退出 | `doc2x logout` | 清除 CLI 登录 |
| 账号/额度/订阅 | `account status --json` | 用于 UI 展示与"未登录/额度不足"提示 |
| 模型列表 | `models list --json`、`models show <id> --json` | 默认免费模型 `10001`；截图中的 `gpt-5.6-luna` 是模型 ID，必须动态获取，不能硬编码 |
| 翻译 | `translate <pdf>` | `--translate-type md\|pdf`、`--target-language`（11 种）、`--target-model`、`--term-id`、`--pdf-font-strategy`、`--convert-trans`、`--contextual-translation`、`--ignore-translate-types`、`--to`、`--docx-template`、`--out`、`--receipt`、`--json` |
| 解析 | `parse <pdf\|图片>` | 输出 md/tex/docx/html/pdf/none；PDF ≤ 300 MB，图片 ≤ 3 MB，不接受 DOC/DOCX/PPT/WebP/TIFF |
| 批量 | `batch translate` | 服务端并发固定为 1，只能串行；报告 JSON，退出码 6 表示部分失败 |
| 记录/用量 | `records list/show`、`usage show <id>` | 单任务已报告用量；消费账单历史不开放 |
| 退出码 | 0 成功；1 参数；2 认证/额度/订阅；3 输入文件；4 服务端任务；5 导出/下载；6 批量部分失败 | UI 必须据此给出中文提示与重试路径 |

**官网有而 CLI 没有的能力**（不得假称支持）：保留排版 Word/WPS、MathType 专用 Word、EduEditor、
Typst、表格 Excel 导出、扫描版文本层、图片翻译编辑画布。保留排版翻译固定输出"原文左、译文右"的双语
PDF，没有切换上下排布、反转顺序或仅译文的开关。

## 3. 集成方案

### 3.1 模块落点（遵守依赖方向 `ui -> workbench/features -> platform/core`）

- `src/platform/doc2x/doc2xCli.ts`（已建）：纯适配层。请求拼装、输入/设置校验、退出码映射、
  回执解析。不 import Tauri，可在 Node 测试里直接跑。
- `src/platform/doc2x/doc2xOutcome.ts`（已建）：`runDoc2xTask(request, runner)` 把一次 CLI 运行映射为
  `success / failed / timeout / error`，runner 可注入，同样不 import Tauri。
- `src/platform/doc2x/doc2xDetect.ts`（已建）：基于现有 `run_project_command` 的 CLI 可用性/版本探测。
- `src/platform/doc2x/doc2xRunner.ts`（已建）：Tauri 绑定（`run_doc2x_command`、`start_doc2x_login`、
  `cancel_doc2x_job`、`doc2x://event` 监听）。
- `src-tauri/src/doc2x_cli.rs`（已建）：异步执行层。
  - `run_doc2x_command`：`#[tauri::command(async)]`，超时上限 15 分钟（可配，封顶 60 分钟），
    超时即 kill 并回报 `timedOut`，绝不把超时算成功；stdout/stderr 只保留尾部 8192 字符。
  - `start_doc2x_login` / `cancel_doc2x_job`：登录是"等用户在浏览器完成回调"的长过程，
    子进程 stdout/stderr 逐行经 `doc2x://event` 推送，退出时再推 `Doc2xJobExit`；
    进程登记用 `OnceLock<Mutex<HashMap<String, Child>>>`（不用 Tauri state），
    这样 `lib.rs` 只需在现有行上追加模块名与三个命令路径。
  - 参数校验：拒绝含换行的参数、空参数；`--auth-mode` 只允许 `oauth`，挡掉"静默改用桌面端账号"。
- `src/features/library/`（下一步）：一键翻译入口（文献右键菜单/详情面板按钮）、译文进度与失败提示、
  设置面板（放在 library 场景贡献的 settings 中）。
- `src/core/`：只放纯类型与设置默认值，不 import React/Tauri。

### 3.2 调用约定

- 所有任务命令统一带 `--auth-mode oauth`，强制使用用户在本机 CLI 登录的账号；
  不用自动模式，避免静默落到 Doc2X 桌面端账号（那不是用户在界面里选择的账号）。
- 每个任务写 `--receipt <run>/receipt.json --json`，用回执里的 `translateId` 关联
  `usage show`，用 `outputFiles` 定位译文文件。
- 译文输出目录放在应用数据区下的 `translations/<paperId>/<runId>/`，作为该文献的衍生文件登记，
  **不新建文献条目**，原主 PDF、标注、笔记保持不变。

### 3.3 需要用户本机满足的条件

1. Node.js ≥ 22；2. 已 `npm i -g @noedgeai-org/doc2x-cli`；3. 已在本机完成 `doc2x login`；
4. 账号有可用额度/订阅（否则退出码 2）。任一条不满足都要给出可理解的安装/登录指引，
   不得静默失败，也不得由软件代登录或代传凭据。

## 4. 本次已落地内容

新增/修改文件：

- `src/platform/doc2x/doc2xCli.ts`：`buildDoc2xTranslateRequest`、`buildDoc2xParseRequest`、
  `buildDoc2xLoginRequest`/`LogoutRequest`、`buildDoc2xAccountStatusRequest`、
  `buildDoc2xModelsListRequest`、`buildDoc2xRecordsListRequest`、`buildDoc2xUsageRequest`、
  `validateDoc2xInput`、`validateDoc2xTranslateSettings`、`describeDoc2xFailure`、
  `parseDoc2xJsonPayload`、`parseDoc2xReceipt(Text)`、`parseDoc2xVersion`、`parseNodeMajor`。
- `src/platform/doc2x/doc2xOutcome.ts`、`doc2xRunner.ts`、`doc2xDetect.ts`、`index.ts`。
- `src-tauri/src/doc2x_cli.rs` + `src-tauri/src/lib.rs`（模块与三个命令挂在现有行上，
  文件仍满足"lib.rs < 160 行"的架构约束）。
- `scripts/verify-doc2x-cli.mjs` + `package.json` 脚本 `test:doc2x-cli`。

验证结果（worktree 内）：

- `npm run test:doc2x-cli` → **15 pass / 0 fail**（mock CLI + 假 runner）
- `cargo test --manifest-path src-tauri/Cargo.toml --lib doc2x_cli::` → **6 passed / 0 failed**
- `npx tsc -b` → 退出 0；`npm run test:architecture` → 通过；`git diff --check` 干净

过程中实测发现并已修正的问题：

1. 布尔标志（`--json`、`--no-browser`、`--contextual-translation`）最初没有真正写入参数数组；
2. `--ignore-translate-types` 多值只传入第一个；
3. `State<'_, Doc2xJobs>` 不能移入 `'static` 线程（E0521）→ 改为 `OnceLock` 进程登记表；
4. `lib.rs` 超过 160 行会触发架构边界检查 → 模块与命令改为挂在现有行上。

## 5. 未完成与风险

- 未做：登录流程 UI、设置 UI、一键翻译入口与译文入库、批量串行队列、
  真实账号端到端（用户未提供已登录且有订阅的账号，不得自行注册或代登录）。
- 远端能力风险：模型清单、术语表 ID、订阅门槛由 Doc2X 侧决定，CLI 升级可能增删参数；
  适配层把可选值集中成常量表，变更时只改一处。
- 批量翻译受服务端并发 1 限制，多篇文献只能串行，UI 必须显示队列位置与整体进度。
- 安装引导不得由软件静默执行 `npm i -g`（涉及系统改动），只做检测与指引。
- `run_doc2x_command` 的超时上限是本地猜测值（15 分钟）：Doc2X 未公布任务时长上限，
  超长任务可能被误杀；后续可按 `records`/`usage` 的真实耗时调整。

## 6. 安全与隐私边界

- 不读取、打印、持久化或上传 `cli-oauth-tokens.json` 等任何凭据文件；不运行 `access`。
- 不绕过登录、验证码、额度、订阅或站点限制；不代登录。
- 文件与译文只在用户本机与 Doc2X 服务之间流转，不经过我们的服务器。
- 不使用正式资料库做验证；截图与运行都走隔离实例（`dev:live` + 独立测试库）。

## 7. 验收对照（当前进度）

| 验收项 | 状态 |
| --- | --- |
| 1 可行性说明 | ✅ 本文件 |
| 2 账号登录/状态/退出 | ⬜ Rust 异步登录命令已就绪；UI 待实现 |
| 3 一键翻译与译文入库 | ⬜ 待实现 |
| 4 设置 UI | ⬜ 待实现（参数映射已由适配层固定并测试） |
| 5 失败与重试映射 | ✅ 退出码映射 + 超时/失败/启动错误均已实现并测试；UI 呈现待实现 |
| 6 回归与测试 | ✅ 适配层 15 项前端测试 + 6 项 Rust 测试、`tsc -b`、架构边界通过；既有流程未改动 |
| 7 证据与交付 | ⬜ 进行中（真实账号 E2E 受限于无可用账号） |
| 8 安全与隐私 | ✅ 设计上不接触凭据（含 `--auth-mode` 白名单）；实现待保持 |

## 8. 内置插件 `doc2x.core`（第 3 步，已落地）

- 形态：执行层随主仓发布（`src/platform/doc2x` + `src-tauri/src/doc2x_cli.rs`），
  UI/设置/命令/面板做成内置插件贡献，可整体停用；第三方可安装插件路线因
  `declarative-v1` 只有 heading/paragraph/text/list/link 视图块（无按钮/输入/进度）而否决。
- `src/core/doc2xPlugin.ts`：注册 10 项设置贡献（与 CLI 参数一一对应）、翻译源
  `doc2x`、library 场景工作台面板 `plugin:doc2x.core.panel`、4 条命令
  （`doc2x.account.login|logout|status`、`doc2x.paper.translate`）；
  命令实现由 UI 层通过 `setDoc2xCommandHandlers` 注入，core 不导入 platform。
- `src/core/asterCore.ts`：内置插件表后注册 `createDoc2xPlugin()`，
  `builtinPluginIds` 保留集加入 `doc2x.core`，外部包无法占用该 id。
- `src/features/doc2x/`：`doc2xSettings.ts`（设置值 → CLI 参数映射与校验）、
  `Doc2xTranslatePanel.tsx`（CLI 检测、登录/退出、额度订阅查询、当前文献与批量选中文献
  串行翻译、CLI 输出日志）、`doc2x-panel.css`。
- `src/ui/sceneAdapters.tsx` 与 `src/ui/App.tsx`：面板视图候选按 `plugin:doc2x.core.panel`
  匹配，插件停用即不渲染；设置浮层自动汇总插件设置贡献，无需改 UI。
- 译文入库：`<files_root>/translations/<paperId>/<runId>/`，每次运行独立目录（不覆盖旧译文），
  成功后经 `importTranslatedPdfToLibrary` 绑定回同一文献，不新建条目，原 PDF/标注/笔记不变。
- 测试：`scripts/verify-doc2x-plugin.mjs`（11 例，mock 插件上下文 + 设置映射），
  由 `npm run test:doc2x-cli` 一并执行（合计 26 例全过）；`npx tsc -b`、
  `npm run test:architecture`、`git diff --check` 均通过。
- 未完成：真实账号端到端（需用户提供已登录且有额度的账号）、阅读器可视复核、
  完整 `npm run verify` 与前端生产 build。

## 8. builtin plugin doc2x.core (step 3, landed)

- shape: execution layer ships with the main bundle
  (src/platform/doc2x + src-tauri/src/doc2x_cli.rs);
  settings, provider entry, panel and commands are plugin contributions,
  so the whole surface can be disabled at once.
- src/core/doc2xPlugin.ts: 10 setting contributions mapped 1:1 to CLI flags,
  translation source doc2x, library panel plugin:doc2x.core.panel,
  commands doc2x.account.login|logout|status and doc2x.paper.translate.
  Command bodies are injected by the UI layer via setDoc2xCommandHandlers,
  so core never imports src/platform.
- src/core/asterCore.ts: registers createDoc2xPlugin() after the builtin
  scene loop and reserves doc2x.core in builtinPluginIds.
- src/features/doc2x: doc2xSettings.ts (setting values to CLI arguments),
  Doc2xTranslatePanel.tsx (CLI detect, login/logout, quota query,
  current paper and bulk selection serial translation, CLI log),
  doc2x-panel.css.
- src/ui/sceneAdapters.tsx and src/ui/App.tsx bind the panel view to
  plugin:doc2x.core.panel; the settings overlay picks up plugin settings
  without any UI change.
- outputs land in <files_root>/translations/<paperId>/<runId>/ and are bound
  back to the same paper via importTranslatedPdfToLibrary; no new entry,
  source PDF, annotations and notes untouched.
- tests: scripts/verify-doc2x-plugin.mjs (11 cases) runs with
  npm run test:doc2x-cli (26 cases total, all pass); npx tsc -b,
  npm run test:architecture and git diff --check pass.
- still open: real account end to end, reader visual check,
  full npm run verify and the frontend production build.

## 8. builtin plugin doc2x.core (step 3, landed)

- shape: the execution layer ships with the main bundle
  (src/platform/doc2x + src-tauri/src/doc2x_cli.rs) while settings,
  provider entry, panel and commands are plugin contributions,
  so the whole surface can be disabled at once.
- src/core/doc2xPlugin.ts: 10 setting contributions mapped 1:1 to CLI
  flags, translation source doc2x, library panel
  plugin:doc2x.core.panel, commands doc2x.account.login|logout|status
  and doc2x.paper.translate. Command bodies are injected by the UI layer
  through setDoc2xCommandHandlers, so core never imports src/platform.
- src/core/asterCore.ts: registers createDoc2xPlugin() after the builtin
  scene loop and reserves doc2x.core inside builtinPluginIds.
- src/features/doc2x: doc2xSettings.ts (setting values to CLI arguments),
  Doc2xTranslatePanel.tsx (CLI detect, login/logout, quota query,
  current paper and bulk selection serial translation, CLI log),
  doc2x-panel.css.
- src/ui/sceneAdapters.tsx and src/ui/App.tsx bind the panel view to
  plugin:doc2x.core.panel; the settings overlay picks up plugin settings
  without any UI change.
- outputs land in <files_root>/translations/<paperId>/<runId>/ and are
  bound back to the same paper through importTranslatedPdfToLibrary;
  no new library entry, source PDF, annotations and notes untouched.
- tests: scripts/verify-doc2x-plugin.mjs (11 cases) runs together with
  npm run test:doc2x-cli (26 cases, all pass); npx tsc -b,
  npm run test:architecture and git diff --check pass.
- still open: real account end to end, reader visual check,
  full npm run verify and the frontend production build.

## 9. one-click CLI install (step 4, landed)

- the Doc2X CLI is an npm package, so the app can install it for the user,
  but only after an explicit confirmation click; nothing installs silently.
- panel flow: detect CLI (and Node) -> show guidance -> [install Doc2X CLI]
  -> confirm (shows the exact npm command) -> streamed progress -> re-detect.
- optional domestic mirror checkbox (registry.npmmirror.com); the mirror is
  validated as a plain https URL before it reaches the process.
- Rust: doc2x_cli::install_doc2x_cli runs `node <npm-cli.js> install -g
  @noedgeai-org/doc2x-cli` because Windows cannot spawn npm.cmd through
  CreateProcess; the shared spawn_streamed helper feeds doc2x://event, so
  the install logs exactly like a login.
- when Node.js is missing or older than 22 the install button stays disabled
  and the panel points at https://nodejs.org/ instead of failing halfway.
- tests: cargo doc2x_cli:: 9 passed (install command shape, mirror pinning,
  registry validation); node test:doc2x-cli 28 passed (registry
  normalisation, missing-CLI guidance). tsc -b, test:architecture and
  git diff --check pass.
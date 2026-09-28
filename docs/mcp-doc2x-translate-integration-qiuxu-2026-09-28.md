# Doc2X 翻译集成：可行性结论与适配层落地（qiuxu，2026-09-28）

任务：`c889e6ad-fdb9-415c-89ca-383e61197203`（rev2 进行中）
分支：`feat/doc2x-translate-qiuxu`（worktree `.worktrees/doc2x-translate-qiuxu`，基线 `b008046`）

## 1. 结论

**可以集成，成本中等，且与"用户登录自己的 Doc2X 账号"的诉求天然吻合。**

- CLI 是普通 npm 可执行文件（`@noedgeai-org/doc2x-cli`，要求 Node.js ≥ 22），以子进程方式调用即可，
  参数、`--json` 输出、`--receipt` 回执和退出码语义都很规矩，不需要逆向任何私有协议。
- 登录走 OAuth 2.0 + PKCE，回调发生在本机随机 127.0.0.1 端口；令牌由 CLI 自存于
  `%APPDATA%/doc2x/cli-oauth-tokens.json`。**我们的软件不读取、不复制、不上传该文件**，
  只调用 `doc2x login/logout/account status`，因此不会碰到用户凭据。
- 主要成本在：长任务与登录需要新的异步 Rust 命令（现有命令是同步阻塞且无超时）、
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

- `src/platform/doc2x/`（本次已建）：纯适配层，负责参数拼装、输入/设置校验、退出码映射、回执解析。
  不 import Tauri（`doc2xDetect.ts` 单独承担探测绑定），因此可在 Node 测试里直接跑。
- `src/platform/doc2x/doc2xRunner.ts`（下一步）：Tauri 绑定层，负责任务执行、进度事件、取消。
- `src-tauri/src/doc2x_cli.rs`（下一步）：异步命令 `run_doc2x_command` / `start_doc2x_login`，
  带超时与取消；不复用同步的 `run_project_command`（它无超时，长任务会卡住 UI）。
- `src/features/library/`：一键翻译入口（文献右键菜单/详情面板按钮）、译文进度与失败提示、
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

新增文件：

- `src/platform/doc2x/doc2xCli.ts`：纯适配层。含 `buildDoc2xTranslateRequest`、`buildDoc2xParseRequest`、
  `buildDoc2xLoginRequest`/`LogoutRequest`、`buildDoc2xAccountStatusRequest`、`buildDoc2xModelsListRequest`、
  `buildDoc2xRecordsListRequest`、`buildDoc2xUsageRequest`、`validateDoc2xInput`、
  `validateDoc2xTranslateSettings`、`describeDoc2xFailure`、`parseDoc2xJsonPayload`、
  `parseDoc2xReceipt(Text)`、`parseDoc2xVersion`、`parseNodeMajor`。
- `src/platform/doc2x/doc2xDetect.ts`：基于现有 `run_project_command` 的 CLI 可用性/版本探测。
- `src/platform/doc2x/index.ts`：稳定出口。
- `scripts/verify-doc2x-cli.mjs` + `package.json` 脚本 `test:doc2x-cli`：用假 CLI 跑通
  参数拼装、跨字段校验、输入上限、退出码映射、回执解析、"失败不产生回执"。

验证结果（worktree 内）：

- `node --experimental-strip-types --test scripts/verify-doc2x-cli.mjs` → **9 pass / 0 fail**
- `npx tsc -b` → 退出 0

修复过程中实测发现并已修正的实现问题：布尔标志（`--json`、`--no-browser`、`--contextual-translation`）
最初没有真正写入参数数组；`--ignore-translate-types` 多值只传入第一个。两者都由上述测试捕获。

## 5. 未完成与风险

- 未做：异步 Rust 执行/流式命令、登录流程 UI、设置 UI、一键翻译入口与译文入库、批量串行队列、
  真实账号端到端（用户未提供已登录且有订阅的账号，不得自行注册或代登录）。
- 远端能力风险：模型清单、术语表 ID、订阅门槛由 Doc2X 侧决定，CLI 升级可能增删参数；
  适配层把可选值集中成常量表，变更时只改一处。
- 批量翻译受服务端并发 1 限制，多篇文献只能串行，UI 必须显示队列位置与整体进度。
- 安装引导不得由软件静默执行 `npm i -g`（涉及系统改动），只做检测与指引。

## 6. 安全与隐私边界

- 不读取、打印、持久化或上传 `cli-oauth-tokens.json` 等任何凭据文件；不运行 `access`。
- 不绕过登录、验证码、额度、订阅或站点限制；不代登录。
- 文件与译文只在用户本机与 Doc2X 服务之间流转，不经过我们的服务器。
- 不使用正式资料库做验证；截图与运行都走隔离实例（`dev:live` + 独立测试库）。

## 7. 验收对照（当前进度）

| 验收项 | 状态 |
| --- | --- |
| 1 可行性说明 | ✅ 本文件 |
| 2 账号登录/状态/退出 | ⬜ 待实现（Rust 异步登录 + UI） |
| 3 一键翻译与译文入库 | ⬜ 待实现 |
| 4 设置 UI | ⬜ 待实现（参数映射已由适配层固定） |
| 5 失败与重试映射 | ✅ 退出码映射已实现并测试；UI 呈现待实现 |
| 6 回归与测试 | ✅ 适配层 9 项测试 + `tsc -b`；既有流程未改动 |
| 7 证据与交付 | ⬜ 进行中（真实账号 E2E 受限于无可用账号） |
| 8 安全与隐私 | ✅ 设计上不接触凭据；实现待保持 |

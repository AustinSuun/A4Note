# MCP 重连接准备：隧道、规则与工具矩阵（Arena one）— 2026-09-21

任务：无任务卡，用户要求的「连接 MCP + 明确使用规则 + 熟悉工具」准备轮。
执行者：本地 Agent 别名 `arena-one`（worker，会话文件 `%USERPROFILE%\.a4note-project-tasks\sessions\arena-session.json`，仅本对话使用，不入库、不共享）。
范围：只读连接、只读侦察与文档同步；未领取任何任务卡。

## 1. 连接事实

| 项目 | 结果 |
| --- | --- |
| 传输 | Streamable HTTP（`text/event-stream`），协议 2024-11-05 |
| 服务端 | `shuncode-bridge` 0.7.4，capabilities `tools` + `logging`，可用工具 15 个 |
| 会话 | `initialize` 后服务端下发 `Mcp-Session-Id`；后续请求必须回带 |
| 并发约束 | 同一会话内多个请求必须使用互不相同的 JSON-RPC `id`，否则 `-32009` / HTTP 409（本轮实测踩坑并修正） |
| 剩余约束 | 会话内一次只允许一个同 `id` 请求在飞；断线重连后旧 session id 失效需重新 `initialize` |
| 客户端 | 仓库外私有脚本 `mcp/mcp.py`（会话缓存于 `~/.cache/shun_mcp_session`），支持单次调用与并发批处理 |

工具矩阵（15）：文件类 `list_directory` / `find_files` / `search_files` / `read_files` / `read_image` / `apply_patch`；
执行类 `run_command` / `get_command_output` / `send_command_input` / `cancel_command`；语义类 `lsp` / `get_diagnostics`；
编排类 `set_todos` / `update_plan` / `report_progress`。

关键运行特征：

- `run_command` 是 Windows 原生 Bash PTY（product-bundled PortableGit，`--noprofile --norc`），路径用 `/d/...`；`timeout_ms` 上限 120000，超时后命令仍在跑，需用 `get_command_output` 续读或 `cancel_command` 停止。
- 跨工具传路径给 Node 时，Node 会把 `/tmp/...` 解析成 `D:\tmp\...`，需 `cygpath -w` 转换或直接用 Windows 路径。
- 复杂引号在 `run_command` 里易被 PTY 吞掉并挂起（本轮两次实测），超过一行的逻辑先 here-doc 写脚本再 `bash` 执行。
- 独立工具调用可并发，Bridge 会并行执行；对同一文件的写操作必须串行。

## 2. 规则（本仓库约束，已确认）

- 入口顺序：`AGENTS.md` → `docs/notes/DEVELOPMENT_HANDBOOK.md` → `docs/notes/AGENT_STATUS.md` → `plans/PROJECT_STATUS.json` → `npm run status` / `git status --short`。
- 状态同步：开始、完成、阻塞都要更新 `AGENT_STATUS.md` 与 `PROJECT_STATUS.json` 的 `updatedAt`、工作范围、验证结果与下一步；交接按「目标 / 已完成 / 修改文件 / 验证结果 / 已知风险 / 下一步」书写。
- 高冲突文件同一时间只允许一个 Agent 大改：`src/ui/App.tsx`、`src/core/types.ts`、`src-tauri/src/lib.rs`、`src/ui/styles/tokens.css`、`src/ui/styles/workbench.css`。能拆新文件就不要扩大它们。
- 验证矩阵：普通 TS/UI 改动用 `npm run build` + `npm run test:architecture`；涉及插件/场景/工作台/状态/资源/Reader/数据/Rust 用 `npm run verify`。
- 界面任务截图必须来自 `npm run dev:live -- --instance <代号> --port <独立端口> --cdp-port <独立端口>` 的真实应用区域，保留底部 `DEV <代号> · 独立测试库` 状态条；用 `playwright-core` 驱动本机 Chrome 连 CDP 自动产出，存 `.tmp/shots/`，不得放进 `docs/`。
- 代码任务由执行 Agent 自验并合并到本地 `main` 后再 submit；冲突、脏 main、验证失败一律报阻塞，不强行覆盖；默认不推送、不打包、不安装、不发布。
- 任务服务：默认 worker，不自行提权 dispatcher；不自动领取任务，仅在用户授权后 `claim`；每次修改前 `get` 最新 revision 与附件，409 后重读；约 60 秒 heartbeat。
- 交付同步：本轮这类分析/计划/复盘写入 `docs/mcp-<topic>.md`（LF 结尾、无行尾空格）；探针脚本、机读基线与日志留在 `docs/` 之外。

## 3. 环境与任务板快照

- 工作区根 `D:\WorkSpace\Aster`，分支 `main`。会话开始时 HEAD 为 `e74b5bd`（Merge fix/reader-escape-qingsui 009cede5），工作树仅 `?? .worktrees/` 与 `?? docs/screenshots/` 未跟踪；会话中另一 Agent 合入 `e394cfe`（Merge fix/pdf-annotation-qingyan，交付卡 `b6c1a566` 的标注几何/文字工具/跨页橡皮修复），会话结束时 HEAD 为 `e394cfe`。
- 并发观察：约 15:42 期间 `plans/PROJECT_STATUS.json` 一度处于未合并（Unmerged）并带冲突标记，随即由该合并方解决并随 `e394cfe` 提交；本轮未介入该冲突、未写入、未提交，写入前一律带 `expected_versions` 哈希守卫（本轮据此成功中止了一次对冲突态的覆盖）。
- 运行踩坑：本机 `git log`/`git status` 在 Bridge PTY 下会进 pager 并挂住命令，须 `export GIT_PAGER=cat` 或 `git --no-pager`；被挂起的命令要用 `cancel_command` 收尾。
- 任务服务可用：`doctor` → `available: true`，`http://127.0.0.1:4319/projects/db83d583-436f-474c-9480-a42e4147b46a`，capabilities `queue` / `acceptance` / `offlineTakeover` 齐全。
- 任务板共 50 卡：39 archived、7 queued、3 in_progress、1 review。

| 状态 | 优先级 | 卡号 | 标题（截断） |
| --- | --- | --- | --- |
| in_progress | high | `0bd39f48` | 阅读器：标注列表面板缺少用户入口 |
| in_progress | high | `b6c1a566` | PDF阅读标注修复：高亮/下划线对齐与行高、文本标注字号、橡皮与工具栏色点 |
| in_progress | high | `e8106251` | 阅读器：带 /Rotate 的 PDF 页面文字层未旋转，旋转页无法选取与高亮 |
| review | high | `009cede5` | 阅读器：图形/箭头绘制中按 Escape 不取消草稿 |
| queued | high | `3128932d` | 阅读器：无法创建重叠高亮，拖选经已有标注被截断 |
| queued | high | `8dba61be` | 阅读器：跨页拖选高亮/下划线静默失效，文本框正文被选入 |
| queued | high | `259f7b91` | 阅读器：扫描页/无文字层页面使用文字工具时无提示 |
| queued | high | `fb5e3f2f` | 搭建标注图层系统：多次学习记录、图层选择管理与按层渲染 |
| queued | low | `05795e28` | 重构 Settings UI：信息架构、响应式、可访问性与反馈 |
| queued | low | `9230f8ce` | 搭建上下文快捷键系统：Ctrl 引导层与场景试点 |
| queued | low | `c2a1bcdd` | 重构任务详情弹窗信息层级 |

上述 in_progress / review 卡归属其他 Agent，本轮一律未接管、未心跳、未改动其分支或 worktree。

## 4. 本轮未做

未 claim 任何任务；未修改生产源码与状态文件以外的任何文件；未运行 `npm run build` / `verify` / 打包 / 安装 / 发布；未重启 4319 或任何被 AI 托管的长命令；未写真实资料库；未用 `git reset` / `checkout --` 触碰既有未提交改动。

## 5. 已知风险与下一步

- 阅读标注线是当前最大积压（4 张 high queued + 3 张 in_progress 同源），来源均为已归档审计 `4de2cac5`，证据集中在 `docs/mcp-reader-annotation-audit-arena-2026-09-21.md`（第 3–6 节），复现驱动在 `.worktrees/audit-4de2cac5/.tmp/audit/`。
- `b6c1a566` 与 `e8106251` 同属阅读标注且都处于 in_progress，若由本 Agent 接手需先确认原领取方状态，避免同一源码区域并发编辑。
- 低优 `05795e28`（Settings）与 `c2a1bcdd`（任务弹窗）会触及高冲突文件或任务服务 UI，落点需先与用户确认范围。
- 下一步：等用户指定任务卡；claim 前 `get` 最新 revision、附件与验收条件，再按第 2 节验证矩阵执行并回写双状态。


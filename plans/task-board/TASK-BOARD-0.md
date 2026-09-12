# TASK-BOARD-0：调查 t3code 的任务分配接入面

状态：done（主 Agent review 通过）
负责人：待用户指定 Agent
Review owner：主 Agent（/root）
优先级：P0
预计时长：半天以内

## 目标

确认当前开发环境中的 t3code/Codex 是否提供可供外部任务控制台使用的正式接入面，并据此选择下一阶段的连接器实现方式。

本任务只做事实调查和方案建议，不实现任务板、不修改 Aster 产品代码，也不向任何 t3code 对话发送消息。

## 前置依赖

- 可访问当前机器上安装或运行的 t3code 实例。
- 能确认 t3code 版本、安装位置或源码位置；如果无法访问，必须在报告中明确说明。
- 阅读仓库入口文件：`AGENTS.md`、`docs/notes/DEVELOPMENT_HANDBOOK.md`、`docs/notes/CLI_REUSE_STRATEGY.md`。

## 允许修改

- 只允许新增或修改本任务报告：`plans/task-board/TASK-BOARD-0-REPORT.md`。
- 如确实需要保存探测脚本，只能放在 `plans/task-board/investigation/`，并在报告中说明用途。
- 按项目总规约完成交接时，可以只更新 `docs/notes/AGENT_STATUS.md` 和 `plans/PROJECT_STATUS.json` 的本任务状态、验证结果和下一步；不得改写其他历史内容。

## 禁止修改

- 禁止修改 `src/`、`src-tauri/`、`server/`、`package.json`、`AGENTS.md` 以及除本任务交接所需最小更新之外的 `docs/notes/` 内容。
- 禁止修改或删除与本任务无关的状态历史；状态文件只能追加本任务的交接记录。
- 禁止修改、删除或重置工作区已有改动。
- 禁止读取、输出或提交 Codex/t3code 凭据、token、cookie、个人消息内容或完整会话记录。
- 禁止自动发送消息、创建会话、修改 t3code 设置或终止正在运行的 Agent。
- 禁止使用 DOM 抓取或按坐标点击作为“已支持正式 API”的证据；如果只能这样做，必须把它列为不可靠的 fallback。

## 必须调查的内容

1. t3code 当前版本、运行方式和可定位的安装/源码位置。
2. 是否存在正式的插件、扩展、MCP、IPC、localhost HTTP/WebSocket、CLI 或其他外部调用接口。
3. 是否能枚举会话/线程，并取得稳定的 conversation/thread/session ID。
4. 是否能向指定会话追加一条用户消息，是否需要用户确认，是否能读取事件流或运行状态。
5. 是否能区分 Agent 的 `idle`、`running`、`waiting`、`failed`、`closed` 等状态，状态来源和刷新方式是什么。
6. 是否能让 Agent 通过 MCP 或消息回写 `taskId`、进度、验证结果、阻塞原因和最终交接。
7. 如果正式接口不存在，评估“任务包写文件 + 复制到剪贴板 + 用户确认发送”的 fallback，并说明不能自动化的部分。
8. 检查是否可以合法复用 t3code 代码；保留 MIT 许可要求，不复制整个应用。

## 报告格式

将结果写入 `plans/task-board/TASK-BOARD-0-REPORT.md`，至少包含：

```text
调查时间：
t3code 版本/来源：
已验证事实：
证据（命令、文件、接口名称或文档链接）：
可用能力：
不可用能力：
推荐连接器：
Fallback 方案：
安全/隐私限制：
对 TASK-BOARD-1 的具体建议：
未解决问题：
``` 

结论必须明确选择以下一种：

- `A`：可以通过正式插件/API/MCP/IPC 实现一键分配。
- `B`：可以读取状态，但发送消息需要用户确认或复制粘贴。
- `C`：当前只能做独立任务板，暂时没有可靠的 t3code 接入面。

## 验收标准

- 报告能给出版本和事实证据，不能只写推测。
- 明确说明能否枚举 Agent 对话、发送任务、读取运行状态和接收交接。
- 给出推荐方案及其限制，并说明下一张任务卡应实现什么。
- 没有产品代码改动、没有凭据泄露、没有发送外部消息。
- 报告完成后把本任务状态交给主 Agent review，不要自行宣称完成整个任务板项目。

## 验证命令

```powershell
git status --short
npm run test:agent-status
```

只读调查无需运行 `npm run build` 或 `npm run verify`；如果新增了探测脚本，必须至少运行对应脚本并在报告中记录结果。

## 交接要求

回复主 Agent 时必须包含：报告路径、结论 `A/B/C`、关键证据、推荐下一步、未解决问题和实际运行过的命令。

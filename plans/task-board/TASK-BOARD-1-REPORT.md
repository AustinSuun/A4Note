# TASK-BOARD-1 实现报告

调查/实现时间：2026-09-05T15:13:17+08:00

## 结论

实现完成，但真实 T3 environment 尚未授权实连验证。独立 `apps/agent-board` 已提供连接配置、`GET /api/orchestration/snapshot` 读取、状态映射、错误分类、任务包 fallback 和不发送请求的 dry-run 预览。当前没有调用真实账户环境，也没有实现或暴露 `thread.turn.start` 发送入口。

## 修改文件

- `apps/agent-board/index.html`：独立控制台页面，包含连接、snapshot、dry-run 和 fallback 四个区域。
- `apps/agent-board/src/connector.mjs`：T3 HTTP connector 核心；集中处理 endpoint 规范化、认证头、超时、HTTP 错误、snapshot 解析、状态映射和 DispatchPreview。
- `apps/agent-board/src/connector.d.ts`：`ConnectorConfig`、`ConnectionCheck`、`OrchestrationSnapshot` 和 `DispatchPreview` 类型边界。
- `apps/agent-board/src/app.mjs`：页面状态装配；凭据只保存在当前页面内存，不使用 localStorage、SQLite 或日志。
- `apps/agent-board/src/styles.css`：响应式、可访问的独立工作台样式。
- `apps/agent-board/server.mjs`：静态 server；`AGENT_BOARD_MOCK=1` 时才启用脱敏 mock snapshot 路由。
- `apps/agent-board/test/connector.test.mjs`：纯函数、mock HTTP 和 dry-run 测试。
- `apps/agent-board/package.json`、`apps/agent-board/README.md`：独立启动与测试说明。

## 已验证能力

- 未配置 endpoint 返回 `notConfigured`，页面提供可复制的任务包 fallback。
- endpoint 只接受 `http`/`https`，移除 query/fragment；带用户名/密码的 URL 会被拒绝，错误结果不会回显凭据。
- `none`、`bearer`、`dpop` 和 `custom` 认证头只在请求内存中构造；不持久化 token、cookie、DPoP 或完整 authorization header。
- 成功响应必须包含 `snapshotSequence`、`projects` 和 `threads`；项目/线程只使用响应中的显式 `id`/`projectId`/`threadId`，不会从标题推导 ID。
- snapshot 保留 `snapshotSequence`、`updatedAt` 和每个实体的原始状态字段，并将未知状态映射为 `error`，以免把未知 provider 状态伪装成空任务。
- 401、403、404、其他 HTTP 错误、网络/CORS/超时和坏 JSON 分别显示可区分错误。
- `createDispatchPreview` 只生成带 `requiresConfirmation: true` 的对象；connector 没有 `dispatch` 方法，dry-run 测试证明 mock server 请求计数保持为零。
- fallback 文本可通过 Clipboard API 复制；Clipboard 被浏览器拒绝时仍显示可手动复制文本。

## 实际运行命令

```powershell
cd D:\WorkSpace\Aster\apps\agent-board
npm test
node --check src\connector.mjs
node --check src\app.mjs
node --check server.mjs

# 脱敏浏览器 smoke server
$env:AGENT_BOARD_MOCK = '1'
$env:AGENT_BOARD_PORT = '4177'
npm start

# 根项目要求
cd D:\WorkSpace\Aster
npm run build
npm run test:architecture
npm run test:agent-status
```

结果：agent-board 测试 14/14 通过；Node 语法检查通过；根项目 build、architecture 和 agent-status 均通过。命令行访问 mock server 的 `GET /api/orchestration/snapshot` 返回 HTTP 200 和脱敏 `mock-seq-1`。T3 预览浏览器可以加载控制台，并在无法访问隔离 localhost endpoint 时显示明确的网络/CORS 错误。

## 未完成与限制

- 用户没有提供明确授权的 T3 environment endpoint、认证方式或 token，因此没有真实 snapshot/dispatch/subscribe 调用结果；不能把 mock 结果标记为真实连通。
- 本任务不实现 `thread.turn.start`、WebSocket `subscribeThread`/`subscribeShell`、断线游标补偿或审批处理；这些应由后续任务在用户确认后实现。
- 浏览器直连真实 environment 可能受到 CORS 限制，生产部署需要同源代理或受控后端代理，不能通过关闭浏览器安全策略解决。
- T3 nightly orchestration schema 仍可能变化；协议字符串和状态映射集中在 connector，后续需增加 schema/version capability 检查。

## 收口复核补充（2026-09-05T19:50:13+08:00）

- 测试认证值已改为明确的 `REDACTED_TEST_*` 合成标识；凭据模式扫描无命中。
- `apps/agent-board` 的 14 项测试、三个 Node 语法检查、根项目 `npm run build` 和 `npm run test:agent-status` 通过。
- 根项目 `npm run test:architecture` 在当前工作区仍失败于既有 Markdown 静态契约：脚本要求 `src/ui/styles/markdown.css` 包含字面量 `.md-body table {`，但该文件当前没有此规则。该文件和校验脚本均属于本轮禁止修改范围，因此未为 TASK-BOARD-1 擅自修复；这不影响 agent-board 测试结果。

## 安全边界

本轮未读取 t3code/Codex 凭据、cookie、会话数据库或个人消息，没有创建会话、发送消息、修改设置或终止 Agent。mock fixture 只包含 synthetic project/thread IDs 和状态。静态 server 的 mock route 默认关闭，且只实现 snapshot GET。

## TASK-BOARD-2 建议

先增加用户确认的真实 environment 连接测试记录和 schema capability 检查，再实现独立的 `DispatchTask` 确认流程：展示 project/thread、权限和完整文本，确认后才允许一次 `thread.turn.start`。随后增加 WebSocket 订阅、snapshotSequence 游标补偿、waiting/approval 状态和断线重连；T3 orchestration 与 Codex app-server 继续保持两个 provider 边界。

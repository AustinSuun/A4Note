# TASK-BOARD-1：实现 t3code environment 连接测试与安全投递预览

状态：ready（等待用户审核）
负责人：待用户指定 Agent
Review owner：主 Agent（/root）
优先级：P0
预计时长：1 到 2 天

## 目标

为独立开发任务控制台建立第一版 t3code environment connector，完成“配置并验证连接、读取任务板可用的线程快照、生成投递预览”的最小闭环。

本任务以 TASK-BOARD-0 的静态合同为前提，但必须把所有真实网络访问限制在用户明确配置并授权的 endpoint；不依赖桌面 Electron IPC、DOM 自动点击或读取 t3code 本地数据库。

## 前置依赖

- 已阅读 `AGENTS.md`、`docs/notes/DEVELOPMENT_HANDBOOK.md`、`plans/task-board/TASK-BOARD-0.md` 和 `plans/task-board/TASK-BOARD-0-REPORT.md`。
- 已确认用户会提供测试用的 T3 environment endpoint 和认证方式；未提供时必须实现未配置状态和 fallback，不得猜测地址或读取凭据文件。
- TASK-BOARD-0 结论为 `A`，但 T3 snapshot/dispatch/subscribe 尚未真实调用，因此本任务先验证只读连接和 dry-run。

## 允许修改

- `apps/agent-board/**`（如果目录尚不存在，可创建独立的轻量 Web 控制台骨架）。
- `plans/task-board/TASK-BOARD-1-REPORT.md`。
- 必要的 `plans/task-board/fixtures/**` 测试 fixture；fixture 必须脱敏且不可包含真实 token、cookie 或会话正文。
- 按项目规约最小追加 `docs/notes/AGENT_STATUS.md` 与 `plans/PROJECT_STATUS.json` 的本任务交接记录。

## 禁止修改

- 禁止修改 Aster 产品运行时代码：`src/**`、`src-tauri/**`、`server/**`、`package.json`。
- 禁止修改 `AGENTS.md`、开发手册及其他任务卡。
- 禁止自动发送 `thread.turn.start`；本任务只做连接测试、snapshot 读取和投递预览/dry-run，真实发送必须留给后续任务并由用户显式确认。
- 禁止把认证 token、cookie、authorization header、DPoP 值写入文件、日志、localStorage、SQLite 或任务卡。
- 禁止把 T3 orchestration 私有 schema 与 Codex app-server schema 混成一个协议；Codex provider 留到后续任务。
- 禁止使用桌面 IPC、DOM 抓取、坐标点击或本地数据库作为正式连接方式。

## 公共接口

在 `apps/agent-board` 内定义最小 connector 边界，名称可调整但职责必须保持：

```ts
type ConnectorConfig = {
  httpBaseUrl: string;
  wsBaseUrl?: string;
  authMode: 'none' | 'bearer' | 'dpop' | 'custom';
};

type ConnectionCheck = {
  ok: boolean;
  endpoint: string;
  latencyMs?: number;
  authRequired?: boolean;
  errorKind?: 'notConfigured' | 'unauthorized' | 'forbidden' | 'notFound' | 'network' | 'invalidResponse' | 'unknown';
};

type OrchestrationSnapshot = {
  snapshotSequence: string | number;
  projects: unknown[];
  threads: unknown[];
  updatedAt?: string;
};

type DispatchPreview = {
  taskId: string;
  projectId: string;
  threadId: string;
  messageId: string;
  text: string;
  requiresConfirmation: true;
};
```

连接器应保留原始 T3 状态字段，同时将会话状态映射为 `starting | ready | running | waiting | stopped | error`，线程状态映射为 `active | idle | archived | closed | compacted | error`。

## 行为验收

1. 未配置 endpoint 时显示清晰的 `notConfigured` 状态，并提供任务包 + 剪贴板 fallback 入口。
2. 用户配置 endpoint 后，可以执行连接测试，显示成功/失败、HTTP 状态分类和延迟；不能回显认证材料。
3. 连接成功后读取 `/api/orchestration/snapshot`，展示项目和线程的稳定 ID、标题/摘要和状态；不能从标题推导 ID。
4. 选择任务和线程后生成 `DispatchPreview`，预览包含 `taskId`、项目、线程、消息 ID、完整任务文本和“需要用户确认”的明确标记。
5. 点击 dry-run 不得产生真实 `thread.turn.start` 请求；网络 fixture 或 mock 必须能证明请求方法和目标路径未被调用。
6. 连接失败、401、403、404、超时、坏 JSON 和未知状态都显示可区分的错误，不得吞掉为“无任务”。
7. 刷新 snapshot 时保留 `snapshotSequence`，为后续游标补偿留下接口；本任务可以不实现 WebSocket 订阅，但报告必须说明未完成部分。
8. 报告说明真实 endpoint 测试结果；如果用户没有提供授权 endpoint，必须把任务标为“实现完成但实连未验证”，不能伪称通过。

## 测试

- 为 URL 拼接、认证头注入、响应解析、状态映射、错误分类和 dry-run 不发送编写纯函数/fixture 测试。
- 测试必须使用脱敏 mock server 或静态 fixture；不得调用真实账户环境作为自动化测试依赖。
- 如果采用浏览器 fetch，验证跨域失败时能给出明确错误，并说明生产环境需要同源代理或受控后端代理。

## 验证命令

```powershell
npm run build
npm run test:architecture
npm run test:agent-status
```

如果新增独立 app 脚本，在报告中记录启动和测试命令。涉及真实 T3 endpoint 的人工验证必须经过用户授权，并记录 endpoint 的非敏感标识、结果和时间，不记录 token。

## 风险与回滚

- T3 nightly contract 可能变化；所有 endpoint、命令和状态映射必须集中在 connector，不得散落到 UI。
- 浏览器直连可能受 CORS 或认证限制；保留受控本地代理/Fallback 设计，不通过关闭安全策略解决。
- 回滚方式是移除 `apps/agent-board` 本任务新增文件和任务报告，不触碰 Aster 产品代码及现有任务状态历史。

## 交接要求

完成后生成 `plans/task-board/TASK-BOARD-1-REPORT.md`，写明修改文件、测试结果、真实 endpoint 是否授权并验证、未实现的 dispatch/subscribe 部分，以及下一步 TASK-BOARD-2 的建议。不要自行宣称实现了完整自动分配。

# TASK-BOARD-2：验证 T3 capability 并实现确认后的单次投递与订阅

状态：in_progress（配对链接接入已实现；等待新的未消费链接完成真实 snapshot）  
负责人：待用户指定 Agent  
Review owner：主 Agent（/root）  
优先级：P0

## 目标

在 TASK-BOARD-1 的只读 connector 基础上，针对用户明确授权的 T3 environment 做一次真实 schema/capability 验证；验证通过后，增加需要用户二次确认的单次 `thread.turn.start` 投递和 WebSocket 事件订阅。T3 orchestration 与 Codex app-server 继续保持独立 provider 边界。

## 前置条件

- 已发现当前 T3 Code 本机 environment：`http://127.0.0.1:3773`；GET `/api/orchestration/snapshot` 在未配对时返回 HTTP 401 `auth_invalid/missing_credential`。
- T3 页面显示 “Pair with this environment”，要求用户在 T3 桌面端输入一次性 pairing token 或 pairing secret；用户已允许进行真实接入排查。
- 用户提供的 `http://192.168.56.1:3773/draft/<id>` 已确认是 T3 草稿对话路由，不是配对链接；真正的桌面配对 URL 使用 `/pair#token=...`，Hosted pairing URL 还可带 `host` 参数。为兼容历史/Hosted 形式，connector 同时接受 query token。
- 执行 Agent 必须把 pairing 凭据只保存在当前进程内存中；不得要求用户把 token 粘贴到聊天、任务卡、日志、localStorage、SQLite 或报告。
- 先执行只读 capability/snapshot 请求；真实 dispatch 仍须在 UI 中展示完整目标和文本并由用户再次确认。

## 允许修改

- `apps/agent-board/**` connector、UI、mock/fixture 和测试。
- `plans/task-board/TASK-BOARD-2-REPORT.md`。
- 必要的 `docs/notes/AGENT_STATUS.md` 与 `plans/PROJECT_STATUS.json` 交接记录。

## 禁止修改

- 禁止修改 `src/**`、`src-tauri/**`、`server/**`、根 `package.json`、其他任务卡和开发手册。
- 禁止读取 t3code 本地数据库、桌面 IPC、DOM/坐标点击或未授权会话消息。
- 禁止自动重试或批量发送；每次真实 dispatch 必须由用户确认完整的 project/thread/message 文本后单次执行。
- 禁止把 T3 orchestration RPC 和 Codex app-server RPC 混成同一个 connector。

## 需要先验证的合同

1. snapshot 的 schema/version、project/thread 显式 ID、权限字段和 `snapshotSequence`。
2. dispatch 方法、路径、请求体、幂等/消息 ID 字段、成功响应和错误响应。
3. WebSocket 握手、认证、订阅消息、事件 envelope、游标/sequence 和断线重连语义。
4. `starting | ready | running | waiting | stopped | error`、`active | idle | archived | closed | compacted | error`、turn/approval 状态的实际取值。

## 执行顺序

1. 将 `http://127.0.0.1:3773` 配置为本机 HTTP endpoint；不要把 endpoint 改成外部站点，也不要扫描其他端口。
2. 在 agent-board 中选择“T3 配对链接”，粘贴刚生成且尚未打开/消费的完整 `/pair#token=...` 链接。connector 只在页面内存中解析并通过 `/oauth/token` 换取 access token，不写入浏览器存储、文件或报告。
3. 配对成功后先调用 `GET /api/orchestration/snapshot`，记录非敏感的 HTTP 状态、schema/version、项目数、线程数、显式 ID 字段和 `snapshotSequence`。
4. 只有 capability/schema 检查通过，且用户在任务板 UI 中核对 project、thread 和完整任务文本后，才允许发送一次 `thread.turn.start`。发送前显示最终请求摘要；发送后只记录非敏感 sequence/result/error kind。
5. 再验证 `subscribeThread` 或等价 WS 订阅：记录握手、订阅确认、已知/未知事件、游标推进和断线补偿；不得自动重发任务。
6. 任一合同不匹配时停止真实发送，将诊断写入报告，并保留 dry-run/fallback。

## 桌面端生成入口

- 在 T3 Code 中进入 `Settings -> Connections`。
- 当前本机环境的 `Authorized clients` 区域点击 `Create link`，生成一次性配对链接；如果只需要字符串，可在生成结果中选择 `Show code` 或复制配对码。
- 如果看不到 `Authorized clients` 或 `Create link`，先确认当前环境已连接且账户会话具有 `access:write` 管理范围；该按钮不是“我的账户”页面的 T3 链接，也不是 `/draft/<id>` 草稿页。
- 如果需要让另一台设备访问 `192.168.56.1:3773`，在 `Connections` 的网络访问设置中启用可达的 network exposure；仅 loopback 时不要把 `127.0.0.1` 链接发给其他设备。

## 配对凭据安全要求

- 不要求用户在聊天中发送 token/secret；不复制到任务卡、报告、日志、剪贴板、localStorage、SQLite 或新的 URL。
- connector 可以在当前进程内存中持有认证材料，并在请求完成后清除；错误分类只能输出 `unauthorized`/`forbidden` 等非敏感信息。
- 不读取 T3 本地数据库、Electron IPC、浏览器 cookies 或完整会话正文。

## 行为验收

- 未通过 capability/schema 检查时，UI 只能显示诊断结果，不展示可点击的真实发送按钮。
- 用户确认前只生成不可执行的 `DispatchPreview`；确认后最多调用一次明确的 `thread.turn.start`，并显示非敏感结果。
- dispatch 请求不得把 token、cookie、DPoP 或完整授权头写入错误信息、历史记录或报告。
- WebSocket 订阅保留 `snapshotSequence`/游标，处理已知事件和未知事件，断线后不会重复发送任务。
- 401、403、404、schema mismatch、网络超时、坏 JSON、WS close/error 必须分类显示，不得吞成“无任务”。
- 自动化测试只使用脱敏 mock server/WebSocket；真实 endpoint 的验证记录只包含非敏感 endpoint 标识、时间、方法/路径、状态分类和用户授权范围。

## 验证命令

```powershell
cd apps/agent-board
npm test
node --check src/connector.mjs
node --check src/app.mjs

cd ../..
npm run build
npm run test:architecture
npm run test:agent-status
```

## 当前阻塞

本机 endpoint 已可访问，但在 T3 配对页面输入一次性凭据前，snapshot 会返回 401。不得猜测凭据来源，也不得用 localhost mock 结果替代真实验证。配对完成后，执行 Agent 应立即记录非敏感结果并继续 capability/schema 验证。

## 交接要求

完成后生成 `plans/task-board/TASK-BOARD-2-REPORT.md`，列出实际验证的非敏感合同、单次投递结果、订阅与断线结果、自动化命令及仍未覆盖的 provider 差异。

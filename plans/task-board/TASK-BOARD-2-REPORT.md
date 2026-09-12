# TASK-BOARD-2 阶段报告：T3 配对链接接入

更新时间：2026-09-07T19:54:34+08:00  
状态：进行中，配对链接支持已完成；真实 snapshot 仍等待新的未消费链接

## 本轮失败诊断修复

- 从 T3 安装包的公开合同确认 `/oauth/token`、`environment-bootstrap` token type 和四个 OAuth exchange 字段与 connector 实现一致；此前失败不是 endpoint 路由写错。
- 修复浏览器/WebView fetch 的 `this` 绑定。旧实现把未绑定的 `globalThis.fetch` 当 connector 方法调用，在当前预览环境会抛出调用上下文错误，界面因此误报“本机配对代理不可用”。
- 配对输入现在同时接受完整 `/pair` URL、相对 `/pair#token=...`、Hosted `host` 和 T3 “Show code” 的直接配对码；Hosted host 的路径会按 T3 客户端规则归一到环境根。
- 代理和 connector 现在只展示安全的 T3 `code/reason` 字段；脱敏无效码的浏览器实测结果为 `pairingFailed / upstream_rejected`，不会显示 token 或响应原文。

本轮验证：Agent Board 19/19；Node 语法检查；根 `npm run build`、`npm run test:architecture`、`npm run test:agent-status`；浏览器无效配对码错误路径。真实 token 仍未读取、记录或发送。

## 已完成

- `apps/agent-board` 新增“T3 配对链接”认证方式，可直接解析 `/pair#token=...`；兼容 query token 和 Hosted `host` 参数。
- connector 向同一 environment 的 `/oauth/token` 执行 OAuth token exchange，请求参数使用 environment bootstrap token 类型和 access token 请求类型。
- pairing token 和换取的 access token 只驻留当前页面/connector 内存；交换成功后立即清除 pairing token 和输入框，不写入 URL、日志、localStorage、文件或错误对象。
- snapshot 请求使用内存中的 Bearer access token；后续刷新复用 access token，不重复消费一次性配对 token。
- 中文页面补充配对输入、说明和清除凭据操作；现有 none/Bearer/DPoP/custom 方式保持可用。
- mock server 增加脱敏 `/oauth/token` 路由，支持浏览器本地验证。
- 浏览器连接通过 Agent Board 同源代理完成 token exchange 和 snapshot，页面只持有短时连接句柄，避免 `4174 -> 3773` 跨源 CORS 失败；代理默认仅允许已知本机/LAN T3 origin，并支持显式 `AGENT_BOARD_T3_ENDPOINT`。
- 配对输入已改为文本输入，表单禁用浏览器原生 URL 校验；`/pair#token=...` 相对路径会使用 HTTP endpoint 补全。服务已重新启动为 loopback-only 的 `http://127.0.0.1:4174`。

## 真实只读验证

- endpoint：本机 loopback T3 environment（不含凭据）。
- 请求：`POST /oauth/token`。
- 结果：HTTP 400，响应没有可安全记录的结构化错误体；未取得 access token，因此没有调用真实 snapshot、dispatch 或 WebSocket subscribe。
- 判断：用户提供的是正确的 `/pair#token=...` 格式，但该一次性链接在验证时已不可交换。常见原因是链接已先被打开/消费、已过期，或 T3 当前实例要求先完成配对确认。不能据此宣称已连接。

## 验证结果

- `cd apps/agent-board; npm test`：18/18 通过，新增同源代理句柄测试。
- `node --check src/connector.mjs`、`src/app.mjs`、`server.mjs`：通过。
- mock 浏览器 HTTP：页面 200、token exchange 200、snapshot 200。
- 同源代理端到端 mock：token exchange、连接句柄 snapshot 和 clear 均成功；access token 没有返回给浏览器侧 connector。
- 根目录 `npm run build`：通过，仅有既有 chunk size warning。
- 根目录 `npm run test:agent-status`：通过。

## 未完成与下一步

- 刷新 Agent Board 后新建一个配对链接，生成后不要先在其他页面打开，直接粘贴到“T3 配对链接”字段并测试连接。此前尝试过的链接可能已被浏览器请求消费，不能复用。
- 真实 snapshot 成功后再记录非敏感 schema/capability；当前仍不允许真实 `thread.turn.start`。
- dispatch 和 WebSocket subscribe 尚未实现。它们必须继续遵循完整目标/文本预览、用户二次确认、单次发送和不自动重试的约束。

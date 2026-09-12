# 多端同步客户端对接计划

更新时间：2026-08-15
服务器依据：`docs/notes/MULTI_PLATFORM_SYNC_SERVER_DESIGN.md`

## 决策

- 第一阶段只同步 `note`，社区、PDF、工作区、Agent 和标注留在后续阶段。
- 网络请求只经过 `src/platform/sync/`；纯协议、重试和冲突规则放在 `src/core/`。
- 本地笔记写入与 outbox 入队必须是同一个 SQLite 事务。
- 服务端游标只有在整页变更成功写入本地后才推进。
- 笔记 ID 按不透明文本处理，以兼容现有 `note-*`/`paper-*` 标识；新 ID 推荐 UUID v4。
- 服务器时间使用 RFC3339，SQLite 内部使用毫秒整数。

## 进度

- [x] S0 客户端协议类型、幂等 operation、游标和冲突模型。
- [x] S0 `server/openapi.yaml` 初稿，锁定认证、push/pull 和错误响应格式。
- [x] S0 HTTP API 适配器：登录、刷新、退出、push、pull、409 兼容解析。
- [x] S2 SQLite `sync_state`、`sync_outbox`、`sync_conflicts` 表及旧库迁移。
- [x] S2 笔记 upsert 与 outbox 同事务、未发送编辑合并。
- [x] S3 本地 pull 事务应用和服务端版本保护。
- [x] S3 指数退避和错误状态记录。
- [x] S3 纯协调器测试及 Rust outbox 原子性测试。
- [x] 代码审查修复：防并发同步、保护本地未上传编辑、拒绝非法响应和游标回退。
- [ ] S1 服务器账号与设备 API 实现（OpenAPI 初稿已完成，待后端实现校验）。
- [ ] S2 首次登录的本地笔记导入/绑定策略。
- [ ] S3 设置页同步状态和冲突处理 UI。
- [ ] S3 将协调器接入应用生命周期和手动同步入口；当前底座已可调用，但尚未自动运行。
- [ ] S4 安全 token 存储、备份、监控和部署 smoke test。

## 服务器对接必须锁定

1. `push` 返回逐操作 `results`；冲突至少包含 `operationId`、`entityId`、`version` 和服务器 `data`。
2. `pull` 的 `cursor` 是用户范围内的单调序列，删除变更必须保留日志并带 `version`。
3. 时间字段统一 RFC3339；服务端不使用客户端时间判断新旧。
4. `notes.id` 和 `paper_id` 使用不透明文本而非强制 UUID，保证现有本地数据可以首次上传。
5. refresh token 只由服务端返回哈希可撤销凭据；桌面端正式发布前接入操作系统安全凭据存储，禁止退回 localStorage。

## 下一步顺序

1. 服务器先落地 S0/S1 OpenAPI、迁移和健康检查。
2. 用测试账号接通桌面首次 push，验证幂等和用户隔离。
3. 接通 pull/删除/断网重试，再开发同步设置页和冲突入口。
4. 完成端到端验收后再进入社区服务设计。

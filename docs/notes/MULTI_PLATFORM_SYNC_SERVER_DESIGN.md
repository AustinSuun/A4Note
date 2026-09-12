# Aster 多端同步与服务器设计

状态：设计稿（第一阶段：笔记同步）  
日期：2026-08-15  
适用版本：A4Note 0.1.x

## 1. 文档目标

本文档定义 Aster 从当前本地优先桌面应用演进为“桌面端 + 手机端 + 云端同步服务”的第一阶段方案。

第一阶段只解决一个闭环：

> 用户在电脑端创建或修改笔记，笔记上传到服务器，手机端登录后可以查看同一份笔记。

本文档暂不设计社区、多人协作、实时共同编辑、推荐系统和复杂附件同步。

## 2. 当前项目基线

当前项目的主要技术形态：

- 前端：React 19、TypeScript、Vite
- 桌面运行时：Tauri 2
- 原生层：Rust
- 本地数据库：SQLite，使用 `rusqlite` bundled SQLite
- 本地文件：应用数据目录下的 `AsterData/files/papers`
- 当前桌面打包：Windows NSIS；发布流水线另有 macOS DMG
- Agent：依赖本机安装的 Codex/Claude CLI

现有数据表包括 `papers`、`paper_files`、`notes`、`annotations`、`tags`、`paper_tags`，以及工作区和 Agent 会话相关表。现有库是设备本地库，没有云端账号、远程 API 或同步队列。

当前架构中必须保留的边界：

1. 桌面端仍然可以离线使用，云端不可用不能阻塞本地读写。
2. 手机端不能直接访问电脑文件系统或桌面端 SQLite，只能访问同步 API。
3. 客户端不能直接连接云数据库，所有远程访问经过 API 和权限校验。
4. 本地路径、工作区标签、窗口状态、Agent 进程和 Agent 会话默认属于设备数据，不进入第一阶段同步。

## 3. 第一阶段范围

### 3.1 纳入同步

首版同步对象为笔记及其必要关联信息：

- 笔记 `id`
- 所属论文 `paper_id`（允许为空时需要在 API 中定义语义）
- 标题 `title`
- Markdown 正文 `content`
- 内容格式 `format`
- 创建时间 `created_at`
- 修改时间 `updated_at`
- 删除时间 `deleted_at`（软删除）
- 服务端版本 `version`

为便于手机展示，服务端可以返回关联论文的只读摘要：标题、作者、年份、DOI。论文完整资料仍由桌面端本地库维护。

### 3.2 暂不纳入同步

- PDF、翻译 PDF、原始文件和任意本地路径
- 工作区、项目根目录、打开的 Tab 和窗口状态
- Agent CLI 会话、进程状态及本地工具输出
- PDF 页面标注和复杂关系图（后续单独设计）
- 社区帖子、评论、点赞、关注和通知
- 多人同时编辑同一篇笔记

## 4. 总体架构

```text
                 HTTPS
┌──────────────────────────────┐
│  A4Note Desktop (Tauri)      │
│  SQLite + Sync Queue          │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│  Aster Sync API               │
│  Auth / Notes / Sync / Audit  │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│  PostgreSQL                   │
│  users / devices / notes      │
│  changes / refresh_tokens     │
└──────────────┬───────────────┘
               │（后续）
        对象存储 / 文件服务

┌──────────────────────────────┐
│  Mobile Client                │
│  登录 + 笔记列表 + 笔记详情    │
└──────────────────────────────┘
```

部署使用 Docker Compose。开发、测试和生产环境使用同一套容器边界，不要求客户端理解容器内部结构。

## 5. 服务端组件

### 5.1 API 服务

API 服务负责：

- 用户注册、登录和 Token 刷新
- 设备登记和撤销
- 笔记查询、创建、更新和软删除
- 增量同步游标
- 请求鉴权、输入校验和错误格式化
- 同步审计日志和健康检查

API 可以使用团队熟悉的后端技术实现。首版重点是稳定的 HTTP/JSON 契约，而不是绑定某一种语言。建议从项目开始就维护 OpenAPI 文档，并从 schema 生成客户端类型。

### 5.2 PostgreSQL

PostgreSQL 是服务端的权威数据源。生产环境必须使用持久化卷或托管数据库，不能把数据库文件放在临时容器层。

### 5.3 文件存储（后续）

PDF、图片等大文件不直接放入 PostgreSQL。后续使用 S3 兼容对象存储（云 OSS、S3 或 MinIO），数据库只保存对象 key、大小、哈希和 MIME 类型。

### 5.4 反向代理

生产环境使用 Caddy 或 Nginx 处理 HTTPS、域名和基本限流。API 容器只暴露给内部 Docker 网络，公网只开放 443（以及必要的 80 到 HTTPS 重定向）。

## 6. 服务端数据模型

以下是第一阶段的逻辑模型，不要求与本地 SQLite 表一一相同。

### 6.1 users

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | UUID | 系统生成且不可变的用户主键 |
| username | text | 唯一，登录标识；注册后默认不可频繁修改 |
| password_hash | text | 只存哈希，不存明文 |
| nickname | text | 展示昵称，可修改 |
| status | text | `active` / `disabled` |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 修改时间 |

首版不要求邮箱、微信或手机号。`id` 使用随机 UUID，不使用连续自增数字作为公开用户标识；`username` 只用于登录和唯一性校验，`nickname` 只用于界面展示。用户名和昵称都必须经过长度、字符集和敏感词校验。

### 6.2 devices

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | UUID | 设备主键 |
| user_id | UUID | 所属用户 |
| name | text | 设备显示名 |
| platform | text | `desktop` / `android` / `ios` / `web` |
| last_seen_at | timestamptz | 最近访问时间 |
| revoked_at | timestamptz | 撤销时间，可为空 |

### 6.3 notes

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 与本地笔记 ID 对应，客户端生成；新客户端使用 UUID v4，服务端保留旧版 `note-*` 标识以兼容已有本地库 |
| user_id | UUID | 数据隔离边界 |
| paper_id | text nullable | 关联论文 ID，首版只作为引用；允许旧版 `paper-*` 标识和空值 |
| title | text | 笔记标题 |
| content | text | Markdown 内容 |
| format | text | 当前固定为 `markdown` |
| version | bigint | 服务端单调递增版本 |
| created_at | timestamptz | 首次创建时间 |
| updated_at | timestamptz | 服务端确认的修改时间 |
| deleted_at | timestamptz nullable | 软删除时间 |

唯一约束：`(user_id, id)`。所有查询必须带 `user_id` 条件，不能仅按客户端提供的 ID 查询。

> 客户端兼容约束：A4Note 0.1.x 已经存在 `note-*` 和 `paper-*` 本地标识，首版服务端不能强制 UUID 校验，否则旧库无法首次上传。新建标识仍推荐 UUID v4；服务端应按不透明文本 ID 校验长度、字符集和用户归属。

### 6.4 sync_changes

该表保存增量同步所需的变更日志：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| sequence | bigint | 按用户单调递增的同步游标；同一用户的每条变更唯一 |
| user_id | UUID | 变更所属用户 |
| entity_type | text | 首版固定为 `note` |
| entity_id | text | 笔记 ID；兼容现有 `note-*` 标识，新建笔记推荐 UUID |
| operation | text | `upsert` / `delete` |
| version | bigint | 该实体的服务端版本 |
| occurred_at | timestamptz | 变更时间 |

变更日志至少保留 30 天。删除记录在日志保留期内不能物理清除，否则新设备无法得知删除事件。

### 6.5 refresh_tokens

只保存 refresh token 的哈希、用户、设备、过期时间和撤销时间。访问 Token 使用短时 JWT 或服务端会话，禁止把长期密钥放进客户端源码。

## 7. API 契约

API 前缀使用 `/api/v1`。响应统一包含 JSON `Content-Type` 和可诊断的 `request_id`。

### 7.1 认证

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/me
POST /api/v1/devices
DELETE /api/v1/devices/{deviceId}
```

登录成功返回：

```json
{
  "accessToken": "短期令牌",
  "expiresIn": 900,
  "refreshToken": "只在安全传输中返回",
  "user": { "id": "...", "username": "...", "nickname": "..." },
  "device": { "id": "...", "platform": "desktop" }
}
```

### 7.2 笔记查询

```text
GET    /api/v1/notes
GET    /api/v1/notes/{id}
POST   /api/v1/notes
PATCH  /api/v1/notes/{id}
DELETE /api/v1/notes/{id}
```

列表接口支持 `cursor`、`limit` 和 `updated_after`。手机端默认只拉取未删除笔记，并按 `updated_at DESC` 展示。

### 7.3 同步接口

首版采用显式 push/pull，而不是 WebSocket 实时同步：

```text
POST /api/v1/sync/push
GET  /api/v1/sync/pull?cursor={cursor}&limit={limit}
GET  /api/v1/sync/status
```

`push` 请求示例：

```json
{
  "deviceId": "device-uuid",
  "operations": [
    {
      "operationId": "client-operation-uuid",
      "entity": "note",
      "entityId": "note-uuid",
      "operation": "upsert",
      "baseVersion": 3,
      "payload": {
        "title": "标题",
        "content": "# Markdown",
        "format": "markdown",
        "paperId": "paper-uuid"
      }
    }
  ]
}
```

`pull` 返回：

```json
{
  "cursor": "1842",
  "hasMore": false,
  "changes": [
    {
      "entity": "note",
      "entityId": "note-uuid",
      "operation": "upsert",
      "version": 4,
      "data": { "id": "note-uuid", "title": "标题", "content": "..." }
    }
  ]
}
```

客户端必须保存最后成功处理的 `cursor`，只有整批变更成功写入本地事务后才能推进游标。首版 `cursor` 是 `sync_changes.sequence` 的十进制字符串（例如 `1842`），服务端不能返回不可排序的 opaque token。

同步 JSON 的时间字段统一使用 RFC3339 字符串；桌面 SQLite 内部可以转换为毫秒整数。`push` 成功响应统一返回逐操作结果，即使批次中有冲突也不要让客户端猜测哪些操作已提交：

```json
{
  "results": [
    { "operationId": "client-operation-uuid", "entityId": "note-uuid", "status": "accepted", "version": 4 },
    {
      "operationId": "other-operation-uuid",
      "entityId": "note-uuid-2",
      "status": "conflict",
      "version": 7,
      "data": { "id": "note-uuid-2", "title": "服务器版本", "content": "...", "format": "markdown" },
      "error": "base_version_stale"
    }
  ]
}
```

批量请求的鉴权、参数或设备错误仍可使用 HTTP 4xx；单条版本冲突既可以作为上述逐操作结果返回，也可以使用 HTTP 409 并在响应体中携带同一字段。客户端会兼容两种形式。

## 8. 同步规则

### 8.1 本地队列

桌面端在本地 SQLite 增加同步辅助表：

```text
sync_state(device_id, cursor, last_success_at, last_error)
sync_outbox(operation_id, entity, entity_id, operation, base_version, payload_json, state, retry_count, next_retry_at)
```

本地写入和 outbox 写入必须在同一个 SQLite 事务内完成，避免“笔记已保存但没有待上传任务”。

### 8.2 推送顺序

1. 先读取未完成的 outbox 操作。
2. 按创建顺序批量调用 `sync/push`。
3. 服务端成功确认后删除或标记 outbox 项。
4. 服务端返回冲突时保留该项，交给冲突策略处理。
5. 网络错误使用指数退避重试，不能无限高速重试。

### 8.3 拉取顺序

1. 使用本地 `cursor` 调用 `sync/pull`。
2. 将返回数据写入本地 SQLite 临时事务。
3. 对本地存在且版本较旧的记录执行更新。
4. 事务成功后写入新 cursor。
5. `hasMore=true` 时继续拉取，不能跳过中间页。

### 8.4 幂等性

每个 push 操作带唯一 `operationId`。服务端保存已处理操作的结果，重复请求返回同一结果，不得产生重复笔记或重复变更日志。

### 8.5 冲突策略

第一阶段采用保守且可解释的规则：

- `baseVersion` 等于服务器当前版本：直接写入并产生新版本。
- `baseVersion` 小于服务器当前版本：判定为冲突。
- 冲突默认不静默覆盖远端内容；API 返回 `409 Conflict`、当前服务端版本和服务端数据。
- 手机端首版只读，因此主要冲突来源是多台电脑。
- 桌面端首版可以提供“保留服务器版本 / 覆盖为本地版本 / 另存冲突副本”三种处理。

不使用客户端时间直接判断新旧，时间仅用于展示；版本由服务器决定。

### 8.6 删除

删除是软删除：写入 `deleted_at`、增加版本并产生 `delete` 变更。设备成功拉取删除事件后才可清理本地内容。服务端在日志保留期结束后再做归档或物理清理。

删除事件的 `pull` change 必须至少包含 `entityId`、`operation=delete` 和 `version`。客户端即使本地没有对应行也必须推进游标；已有本地行则写入删除时间和服务端版本，不能重新入队为 upsert。

## 9. 客户端分层

### 9.1 桌面端改造边界

不让 React 组件直接调用 HTTP。建议新增：

```text
src/core/sync.ts                  # 纯同步模型、状态和冲突类型
src/platform/sync/syncApi.ts      # HTTP/认证环境适配
src/platform/sync/syncRepository.ts # SQLite outbox/cursor 读写
src/features/settings/SyncPanel   # 登录、同步状态、冲突入口
```

Rust 侧继续负责本地 SQLite 和本地文件；同步 API 由 TypeScript platform 层访问，或由 Rust 提供等价的受控封装，二者只能选一个主入口，不能在两边各实现一套同步逻辑。

### 9.2 手机端

手机端只实现云端客户端能力：

- 登录和 Token 保存
- 笔记列表、搜索、详情
- 拉取游标和本地缓存
- 网络离线提示
- Markdown 只读渲染

手机端不读取 `AsterData`、不访问桌面文件夹、不启动本机 CLI。首版可以先做 PWA 或移动 Web，再根据需求封装成 Android/iOS 应用。

### 9.3 共享代码

电脑端和手机端共享：

- OpenAPI 生成的 DTO 类型
- 笔记字段校验
- API 错误码
- Markdown 解析和展示模型
- 同步状态机的纯函数测试

UI、存储实现、平台权限和导航不强行共享。

## 10. Docker 开发与部署

### 10.1 本地 Compose

初始只需要 API 和 PostgreSQL：

```yaml
services:
  api:
    build: ./server
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "8080:8080"

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: aster
      POSTGRES_USER: aster
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - aster-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U aster -d aster"]

volumes:
  aster-db:
```

示例只表达容器边界，密码、镜像版本和真实健康检查必须通过部署配置管理，不能提交真实密钥。

### 10.2 生产部署

- 使用固定镜像版本，不使用 `latest`。
- 数据库使用独立持久化卷或托管 PostgreSQL。
- API 不直接暴露数据库端口。
- 使用 Caddy/Nginx 提供 HTTPS。
- 使用迁移工具管理 schema，不在启动时无条件破坏性重建表。
- 部署前执行数据库备份，部署后执行健康检查和 smoke test。
- 使用滚动或可回滚发布，API 先兼容旧客户端，再删除旧字段。

### 10.3 备份与恢复

至少需要：

- PostgreSQL 每日全量备份
- 重要数据的异地备份
- 定期恢复演练
- 变更日志和服务日志保留策略
- 备份加密和访问权限控制

## 11. 安全要求

- 全部远程请求使用 HTTPS。
- 密码使用 Argon2id 或同等级密码哈希。
- Access Token 短期有效，Refresh Token 可撤销、只存哈希。
- 所有数据库查询按 `user_id` 隔离。
- 服务端校验标题、正文长度、Markdown 大小和请求体大小。
- 限制登录、注册和同步接口的请求频率。
- 日志中不记录密码、Token 或完整笔记正文。
- 设备丢失时可以撤销设备 Token。
- CORS 只允许明确的 Web/PWA 域名。
- 管理数据库和服务器密钥只通过环境变量或密钥管理服务注入。

## 12. API 兼容和版本策略

- 公网接口从 `/api/v1` 开始。
- 新增字段必须向后兼容，客户端忽略未知字段。
- 删除字段或改变语义必须升主版本。
- 数据库迁移和 API 发布分开管理。
- 服务端至少保留一个旧客户端可用版本窗口。
- OpenAPI 文件、生成的 TypeScript 类型和集成测试必须在同一变更中更新。

## 13. 测试策略

### 13.1 单元测试

覆盖：

- 笔记 DTO 校验
- 游标推进
- outbox 状态转换
- 重试退避
- 冲突判断
- 删除事件归约

### 13.2 API 集成测试

使用 Docker PostgreSQL 测试：

- 注册、登录、刷新 Token
- 用户 A 不能读取用户 B 的笔记
- 创建、更新、删除笔记
- push 幂等
- pull 分页和 cursor
- 409 冲突返回完整信息
- 过期 Token、撤销设备和限流

### 13.3 端到端验收

至少验证以下场景：

1. 电脑创建笔记，服务器保存，手机可见。
2. 电脑离线创建笔记，联网后自动上传。
3. 手机重新登录后仍能看到历史笔记。
4. 电脑修改笔记，手机下拉后显示最新版本。
5. 删除笔记后，另一台设备不会重新出现。
6. 重复点击同步不会重复创建数据。
7. 服务器重启后数据和 cursor 不丢失。
8. API 暂时不可用时，桌面端仍能读写本地笔记。

## 14. 实施阶段

### S0：契约和骨架

- 确认笔记字段、ID 和时间语义。
- 创建 `server/` 服务目录。
- 添加 OpenAPI 初稿和错误码。
- Docker Compose 启动 PostgreSQL。
- 建立 CI：迁移、单元测试、API 集成测试。

验收：本地可以启动数据库和空 API，健康检查通过。

### S1：账号和只读查询

- 注册、登录、刷新 Token。
- `GET /notes` 和 `GET /notes/{id}`。
- 手机端用测试账号查看笔记。

验收：手机端可以安全读取用户自己的云端笔记。

### S2：桌面端首次上传

- 增加本地 outbox 和 sync_state。
- 实现笔记 push。
- 首次登录时提供本地笔记导入或绑定策略。

验收：桌面端创建笔记后可上传，重复上传幂等。

### S3：增量拉取和多设备

- 实现 pull cursor。
- 桌面端和手机端都可拉取。
- 实现软删除。
- 增加断网重试和同步状态 UI。

验收：两台设备之间可以稳定同步增、改、删。

### S4：冲突、运维和发布

- 实现 409 冲突处理。
- 加入 HTTPS、备份、日志和监控。
- 部署测试环境和生产环境。
- 发布手机端第一版。

验收：在服务器重启、网络中断、重复请求和冲突场景下数据不丢失。

### S5：后续扩展

- 附件对象存储和断点上传。
- 论文元数据同步。
- 标注同步。
- 手机端编辑。
- 社区服务和管理后台。

## 15. 当前代码落点建议

第一阶段不重写现有 `src-tauri/schema.sql`，而是增加同步辅助表和必要的本地迁移。推荐落点：

```text
server/
  openapi.yaml
  Dockerfile
  migrations/
  src/
  tests/
  docker-compose.yml

src/core/sync.ts
src/platform/sync/syncApi.ts
src/platform/sync/syncRepository.ts
src/features/settings/SyncPanel.tsx
src-tauri/src/database.rs       # 同步表迁移和事务辅助
src-tauri/src/library_notes.rs  # 笔记变更写入 outbox 的边界
```

`library_notes.rs` 负责保证本地笔记变更和 outbox 同事务；同步 HTTP、Token 和重试策略放在 platform/core 层，避免把网络代码塞进 SQLite repository。

## 16. 明确不做的决定

第一阶段明确不做：

- 客户端直连 PostgreSQL
- 用文件夹同步软件代替业务同步
- 通过修改 `updated_at` 猜测冲突
- 手机端访问电脑本地路径
- 把所有桌面 SQLite 表原样复制到云端
- 一开始引入 WebSocket、CRDT 或多人实时编辑
- 在没有备份和权限模型时开放公开分享

## 17. 完成标准

当以下条件全部满足时，第一阶段可以认为完成：

- API 契约已版本化并有自动化测试。
- 用户只能看到自己的笔记。
- 桌面端离线读写不受云端状态影响。
- 电脑端新建、修改、删除可以同步到云端。
- 手机端登录后可以增量查看笔记。
- 重复请求、断网重试和服务重启不会导致数据重复或丢失。
- 数据库有自动备份，且完成过一次恢复演练。
- Docker Compose 可以在新环境启动测试服务。
- 没有把桌面路径、Agent 进程或本地 PDF 误当作可同步数据。

## 18. 第一阶段补充约束

本节将第一阶段实现所需、但容易在具体开发中产生歧义的约束固定下来。

### 18.1 论文关联信息

第一阶段不上传 PDF 和完整论文记录，但移动端笔记列表需要能够显示笔记来源。服务端应在笔记同步数据中提供可选的论文只读摘要：

```text
paper_id
paper_title
paper_authors
paper_year
paper_doi
```

这些字段是展示快照，不代表第一阶段已经同步 `papers` 实体。桌面端没有对应论文时，摘要字段可以为空；移动端必须允许笔记脱离论文正常显示。

### 18.2 幂等操作记录

服务端必须增加 `sync_operations` 表，不能只依赖业务表判断重复请求：

```text
sync_operations
  operation_id       text
  user_id            uuid
  device_id          uuid
  entity_type        text
  entity_id          text
  request_hash       text
  result_json        jsonb
  created_at         timestamptz
```

唯一约束为 `(user_id, operation_id)`。相同操作号重复请求时，服务端返回原操作结果；如果请求体哈希不同，返回 `409 operation_id_reused`，不能覆盖原结果。

### 18.3 游标作用域和失效

`sync_changes.sequence` 在逻辑上按用户递增。`pull` 只处理当前认证用户的变更，客户端不需要也不允许感知其他用户的序号。服务端必须保证同一用户的变更按 `sequence ASC` 返回，不能用 `updated_at` 代替游标排序。

建议使用 `(user_id, sequence)` 作为唯一约束，并为 `(user_id, sequence)`、`(user_id, occurred_at)` 建立索引。生成变更日志和更新笔记必须在同一个数据库事务中完成。

当客户端游标早于服务端仍保留的最小游标时，返回：

```text
HTTP 410
error: CURSOR_EXPIRED
```

响应必须包含 `snapshotCursor`。客户端收到后清空本地同步游标，执行一次分页全量拉取，完成后将 `snapshotCursor` 写入本地事务。服务端不能静默把过期游标当作 `0`。

### 18.4 首次绑定策略

用户第一次在设备上启用同步时，客户端必须让用户选择一种策略：

```text
download_remote   只下载云端笔记，保留本地未同步数据为本地副本
upload_local      将本地笔记作为首次导入提交到云端
merge             合并两边，冲突逐条处理
```

首次导入仍使用普通 `operationId` 和 `baseVersion=0`，不得绕过幂等和权限校验。客户端必须显示待导入数量，不能静默上传整库。

### 18.5 冲突解决流程

冲突响应至少包含 `entityId`、`serverVersion`、完整服务器数据和客户端操作号。桌面端处理冲突时：

1. 保留冲突记录和本地正文，不直接覆盖；
2. 用户选择服务器版本、本地版本或另存为新笔记；
3. 覆盖服务器版本时，必须使用返回的 `serverVersion` 作为新的 `baseVersion` 重试；
4. 另存为新笔记必须生成新的实体 ID，并建立来源备注。

移动端第一阶段只读，不产生笔记冲突写入，但仍应能显示“服务器存在未解决冲突”的状态。

### 18.6 认证和设备安全

- 服务端以 access token 中的 `user_id` 和 `device_id` 为准，不信任请求体中的身份字段。
- refresh token 必须轮换，检测到旧 token 重复使用时撤销该设备的 token 链。
- 桌面端使用系统凭据存储，Android 使用 Keystore，iOS 使用 Keychain；禁止把 refresh token 明文写入 SQLite、localStorage 或日志。
- 注销设备后，该设备的 access token 和 refresh token 立即失效；本地缓存是否清除由客户端注销流程明确执行。
- 登录、刷新、设备注册、push 和 pull 都必须有速率限制和统一错误码。

### 18.7 删除和本地清理

删除始终先写服务端 `deleted_at` 和 `sync_changes(operation=delete)`。客户端收到删除事件后保留最小 tombstone，直到确认该设备的游标已经越过删除事件并完成一次本地事务。

服务端日志保留期结束后，删除记录可以归档或清理，但必须保留一个可用的全量快照恢复路径。重新创建同名笔记视为新实体，不复用已删除实体 ID。

### 18.8 API 统一约定

所有公开路径都使用 `/api/v1` 前缀。分页同步只以 `cursor + limit` 为准；`updated_after` 仅允许用于普通笔记列表查询，不能与同步游标混用。错误响应统一为：

```json
{
  "error": "CURSOR_EXPIRED",
  "message": "同步游标已过期",
  "request_id": "..."
}
```

OpenAPI、生成的 TypeScript DTO、服务端校验和客户端契约测试必须在同一个变更中更新。

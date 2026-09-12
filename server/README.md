# Aster Sync Server

第一阶段同步服务，提供用户名/密码认证、笔记 CRUD 和 push/pull 增量同步接口。

## 本地运行

需要 Node.js 22+ 和 PostgreSQL。推荐直接使用 Docker Compose：

```powershell
cd server
docker compose up --build
```

服务地址：`http://localhost:8080`  
健康检查：`GET /healthz`

当前开发机如果没有 Docker，可以安装 PostgreSQL 后运行：

```powershell
cd server
npm install
$env:DATABASE_URL = "postgres://aster:password@localhost:5432/aster"
npm start
```

## 当前接口

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
GET  /api/v1/me
GET  /api/v1/notes
POST /api/v1/notes
PATCH /api/v1/notes/:id
DELETE /api/v1/notes/:id
POST /api/v1/sync/push
GET  /api/v1/sync/pull?cursor=0
```

当前服务是同步 MVP：Token 为数据库可撤销的 opaque token，笔记使用服务端版本号和软删除，push 使用 `operationId` 保证幂等，pull 使用用户范围内的增量游标。

生产环境还需要替换默认数据库密码、配置 HTTPS、限制 CORS、加入限流和备份，不得直接复用 Compose 中的开发密码。

import {migrateAcceptance, acceptanceState, acceptanceAction, bindAcceptanceEvidence} from './acceptance-store.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => {
  throw new ApiError(status, message);
};
export const text = (v, max = 4000) =>
  typeof v === 'string' && v.length <= max
    ? v
    : fail(400, '文本格式或长度不正确');
export const hash = (v) => createHash('sha256').update(v).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const now = () => new Date().toISOString();
// Keep legacy plan columns in old SQLite files for historical preservation,
// but never expose them as part of the current task API.
const taskColumns = 'id,title,description,acceptance,status,priority,owner,revision,spec_revision,claimed_spec,delivery_revision,acceptance_archive_run,progress,result,feedback,updated_at,created_at';
export class Store {
  constructor(dir, project = 'A4 Note') {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(dir, 'attachments'), {
      recursive: true,
      mode: 0o700,
    });
    this.db = new DatabaseSync(path.join(dir, 'tasks.sqlite'));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,alias TEXT NOT NULL,role TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,last_seen TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,acceptance TEXT NOT NULL,status TEXT NOT NULL,priority TEXT NOT NULL,owner TEXT,revision INTEGER NOT NULL,spec_revision INTEGER NOT NULL,claimed_spec INTEGER,progress TEXT NOT NULL,result TEXT NOT NULL,feedback TEXT NOT NULL,updated_at TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,purpose TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT,actor TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);`);
    let access = this.db
      .prepare("SELECT value FROM meta WHERE key='access'")
      .get();
    if (!access) {
      const a = {
        operatorToken: token(),
        enrollmentToken: token(),
        projectId: randomUUID(),
        project,
      };
      this.db
        .prepare('INSERT INTO meta VALUES (?,?)')
        .run('access', JSON.stringify(a));
      access = { value: JSON.stringify(a) };
    }
    for (const [column, definition] of [
      ['caption', "TEXT NOT NULL DEFAULT ''"],
      ['retired_at', 'TEXT'],
    ]) {
      if (
        !this.db
          .prepare('PRAGMA table_info(attachments)')
          .all()
          .some((c) => c.name === column)
      )
        this.db.exec(
          `ALTER TABLE attachments ADD COLUMN ${column} ${definition}`,
        );
    }
    try { migrateAcceptance(this); } catch (error) { this.db.close(); throw error; }
    this.access = JSON.parse(access.value);
    fs.writeFileSync(
      path.join(dir, 'access.json'),
      JSON.stringify(this.access, null, 2),
      { mode: 0o600 },
    );
  }
  acceptance(id) { return acceptanceState(this,id); }
  acceptanceAction(actor,id,input) { return acceptanceAction(this,actor,id,input); }
  close() {
    this.db.close();
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  event(task, actor, kind, payload = {}) {
    this.db
      .prepare(
        'INSERT INTO events(task_id,actor,kind,payload,created_at) VALUES (?,?,?,?,?)',
      )
      .run(task, actor, kind, JSON.stringify(payload), now());
  }
  auth(value) {
    if (typeof value !== 'string' || value.length > 200)
      fail(401, '需要连接凭据');
    if (hash(value) === hash(this.access.operatorToken))
      return { id: 'human', alias: '你', role: 'human' };
    const a = this.db
      .prepare('SELECT id,alias,role,last_seen FROM agents WHERE token_hash=?')
      .get(hash(value));
    if (!a) fail(401, '凭据无效');
    return a;
  }
  join(credential, body) {
    if (
      ![this.access.enrollmentToken, this.access.operatorToken].some(
        (t) => hash(t) === hash(credential),
      )
    )
      fail(401, '注册凭据无效');
    const role = body.role ?? 'worker';
    if (!['worker', 'dispatcher'].includes(role)) fail(400, '不支持的角色');
    if (
      role === 'dispatcher' &&
      hash(credential) !== hash(this.access.operatorToken)
    )
      fail(403, '派发角色需要项目所有者授权');
    const alias = text(body.alias, 32).trim();
    if (!alias) fail(400, '请填写代号');
    const id = randomUUID(),
      secret = token();
    this.db
      .prepare('INSERT INTO agents VALUES(?,?,?,?,?)')
      .run(id, alias, role, hash(secret), now());
    this.event(null, id, 'agent.join', { alias, role });
    return { id, alias, role, sessionToken: secret };
  }
  heartbeat(actor) {
    if (actor.id !== 'human')
      this.db
        .prepare('UPDATE agents SET last_seen=? WHERE id=?')
        .run(now(), actor.id);
    return { ok: true };
  }
  snapshot() {
    return {
      project: { id: this.access.projectId, name: this.access.project },
      capabilities: {queue: true, acceptance: true},
      sequence: this.db
        .prepare('SELECT coalesce(max(seq),0) n FROM events')
        .get().n,
      tasks: this.db
        .prepare(`SELECT ${taskColumns} FROM tasks ORDER BY updated_at DESC`)
        .all(),
      agents: this.db
        .prepare('SELECT id,alias,role,last_seen FROM agents')
        .all(),
    };
  }
  get(id) {
    const t = this.db.prepare(`SELECT ${taskColumns} FROM tasks WHERE id=?`).get(id);
    if (!t) fail(404, '任务不存在');
    return t;
  }
  detail(id) {
    return {
      ...this.get(id),
      attachments: this.db
        .prepare(
          'SELECT * FROM attachments WHERE task_id=? ORDER BY created_at',
        )
        .all(id),
      events: this.db
        .prepare(
          'SELECT seq,actor,kind,payload,created_at FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 100',
        )
        .all(id),
    };
  }
  create(actor, b) {
    if (!['human', 'dispatcher'].includes(actor.role))
      fail(403, '只有派发Agent或用户可创建任务');
    const title = text(b.title, 160).trim();
    if (!title) fail(400, '请填写任务标题');
    const p = b.priority ?? 'normal';
    if (!['high', 'normal', 'low'].includes(p)) fail(400, '优先级无效');
    const id = randomUUID(),
      date = now();
    this.transaction(() => {
      this.db
        .prepare('INSERT INTO tasks(id,title,description,acceptance,status,priority,owner,revision,spec_revision,claimed_spec,progress,result,feedback,updated_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          id,
          title,
          text(b.description ?? '', 16000),
          text(b.acceptance ?? '', 8000),
          'queued',
          p,
          null,
          1,
          1,
          null,
          '已发布，等待领取',
          '',
          '',
          date,
          date,
        );
      this.event(id, actor.id, 'task.created');
    });
    return this.detail(id);
  }
  update(actor, id, b) {
    return this.transaction(() => {
      const t = this.get(id);
      if (!Number.isInteger(b.revision) || b.revision !== t.revision)
        fail(409, '任务已更新，请刷新后重试');
      if (t.status === 'archived') fail(409, '已归档任务只读');
      const owner = actor.id === t.owner;
      const author = ['human', 'dispatcher'].includes(actor.role);
      const action = b.action;
      if (action === 'edit') {
        if (!author) fail(403, '执行Agent不能修改需求');
        const title = text(b.title ?? t.title, 160).trim();
        if (!title) fail(400, '标题不能为空');
        const p = b.priority ?? t.priority;
        if (!['high', 'normal', 'low'].includes(p)) fail(400, '优先级无效');
        const description = text(b.description ?? t.description, 16000);
        const acceptance = text(b.acceptance ?? t.acceptance, 8000);
        const changed = title !== t.title || description !== t.description || acceptance !== t.acceptance;
        if (!changed && p === t.priority) return this.detail(id);
        this.db.prepare('UPDATE tasks SET title=?,description=?,acceptance=?,priority=?,spec_revision=spec_revision+? WHERE id=?')
          .run(title, description, acceptance, p, changed ? 1 : 0, id);
      } else if (action === 'claim') {
        if (actor.role !== 'worker') fail(403, '请以执行Agent会话领取');
        if (t.status !== 'queued' || t.owner)
          fail(409, '任务需处于任务队列且未被领取');
        this.db
          .prepare(
            "UPDATE tasks SET status='in_progress',owner=?,claimed_spec=spec_revision,progress='已领取' WHERE id=?",
          )
          .run(actor.id, id);
      } else if (action === 'acknowledge') {
        if (!owner || t.status !== 'in_progress')
          fail(403, '只能确认自己正在执行的任务');
        this.db
          .prepare('UPDATE tasks SET claimed_spec=spec_revision WHERE id=?')
          .run(id);
      } else if (action === 'progress') {
        if (!owner || t.status !== 'in_progress')
          fail(403, '只能更新自己正在执行的任务');
        this.db
          .prepare('UPDATE tasks SET progress=? WHERE id=?')
          .run(text(b.progress, 1000), id);
      } else if (action === 'submit') {
        if (!owner || t.status !== 'in_progress')
          fail(403, '只能提交自己的进行中任务');
        if (t.claimed_spec !== t.spec_revision)
          fail(409, '需求已有修改，请读取并确认最新版要求');
        const result = text(b.result, 16000).trim();
        if (!result) fail(400, '需要结果与验证说明');
        this.db
          .prepare(
            "UPDATE tasks SET status='review',result=?,delivery_revision=delivery_revision+1,progress='等待用户检查效果' WHERE id=?",
          )
          .run(result, id);
      } else if (action === 'request_changes') {
        if (actor.role !== 'human' || t.status !== 'review')
          fail(403, '仅用户可退回待验收任务');
        this.db
          .prepare(
            "UPDATE tasks SET status='queued',owner=NULL,claimed_spec=NULL,feedback=?,spec_revision=spec_revision+1,progress='已退回，等待领取调整' WHERE id=?",
          )
          .run(text(b.feedback ?? '', 8000), id);
      } else if (action === 'archive') {
        if (actor.role !== 'human' || t.status !== 'review')
          fail(403, '仅用户可验收归档');
        if (t.claimed_spec !== t.spec_revision)
          fail(409, '提交后需求已变化，请退回调整');
        this.db
          .prepare(
            "UPDATE tasks SET status='archived',progress='用户验收通过' WHERE id=?",
          )
          .run(id);
      } else if (action === 'release') {
        if (!owner || t.status !== 'in_progress' || b.writesStopped !== true)
          fail(403, '仅任务执行者确认停止写入后可交还');
        this.db
          .prepare(
            "UPDATE tasks SET status=?,owner=NULL,claimed_spec=NULL,progress=? WHERE id=?",
          )
          .run('queued', text(b.reason ?? '已停止写入，交还任务', 1000), id);
      } else if (action === 'release_stale') {
        // User-only override for claims whose executing agent went offline:
        // the owner can no longer release, and work must not stay stranded.
        if (actor.role !== 'human')
          fail(403, '仅用户可交还离线执行者的任务');
        if (t.status !== 'in_progress' || !t.owner)
          fail(409, '任务不在执行中，无需交还');
        const reason = text(b.reason, 500).trim();
        if (!reason) fail(400, '请说明交还原因');
        this.db
          .prepare(
            "UPDATE tasks SET status=?,owner=NULL,claimed_spec=NULL,progress=? WHERE id=?",
          )
          .run('queued', '用户交还离线任务：' + reason, id);
      } else if (action === 'delete') {
        // User-only hard delete (attachments files removed best-effort; audit event kept).
        if (actor.role !== 'human') fail(403, '仅用户可删除任务');
        if (t.status === 'in_progress' && t.owner)
          fail(409, '执行中的任务须先交还再删除');
        const files = this.db
          .prepare('SELECT id FROM attachments WHERE task_id=?')
          .all(id);
        this.event(id, actor.id, 'task.delete', { before: t });
        this.db.prepare('DELETE FROM attachments WHERE task_id=?').run(id);
        this.db.prepare('DELETE FROM tasks WHERE id=?').run(id);
        for (const f of files) {
          try {
            fs.rmSync(path.join(this.dir, 'attachments', f.id), { force: true });
          } catch {}
        }
        this.heartbeat(actor);
        return { ok: true, deleted: id };
      } else fail(400, '未知操作');
      this.db
        .prepare('UPDATE tasks SET revision=revision+1,updated_at=? WHERE id=?')
        .run(now(), id);
      this.event(id, actor.id, 'task.' + action, {
        before: t,
        after: this.get(id),
      });
      this.heartbeat(actor);
      return this.detail(id);
    });
  }
  attach(actor, id, b) {
    const name = text(b.name, 180)
      .replace(/[\\/\x00-\x1f]/g, '_')
      .trim();
    if (!name) fail(400, '附件名不能为空');
    const purpose = b.purpose ?? 'reference';
    if (!['reference', 'reproduction', 'result'].includes(purpose))
      fail(400, '附件用途无效');
    if (
      typeof b.base64 !== 'string' ||
      /[^A-Za-z0-9+/=]/.test(b.base64) ||
      b.base64.length % 4 !== 0
    )
      fail(400, '附件编码无效');
    const bytes = Buffer.from(b.base64, 'base64');
    if (bytes.toString('base64') !== b.base64) fail(400, '附件编码无效');
    if (!bytes.length || bytes.length > 10 * 1024 * 1024)
      fail(413, '单个附件限10MB');
    let mime = 'application/octet-stream';
    if (
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      mime = 'image/png';
    else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
      mime = 'image/jpeg';
    else if (
      bytes
        .subarray(0, 6)
        .toString()
        .match(/^GIF8[79]a$/)
    )
      mime = 'image/gif';
    else if (
      bytes.subarray(0, 4).toString() === 'RIFF' &&
      bytes.subarray(8, 12).toString() === 'WEBP'
    )
      mime = 'image/webp';
    if (
      this.db
        .prepare('SELECT count(*) n FROM attachments WHERE task_id=?')
        .get(id).n >= 50
    )
      fail(413, '每任务最多50个附件');
    if (
      this.db.prepare('SELECT coalesce(sum(size),0) n FROM attachments').get()
        .n +
        bytes.length >
      512 * 1024 * 1024
    )
      fail(413, '附件总量超过512MB，请由项目所有者整理');
    const aid = randomUUID(),
      filename = path.join(this.dir, 'attachments', aid);
    fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o600 });
    try {
      return this.transaction(() => {
        const t = this.get(id);
        if (t.revision !== b.revision)
          fail(409, '任务已更新，刷新后再添加附件');
        if (t.status === 'archived') fail(409, '归档任务只读');
        if (
          actor.role === 'worker' &&
          !bindAcceptanceEvidence(this,actor,t,b) &&
          (t.owner !== actor.id ||
            !['in_progress', 'review'].includes(t.status) ||
            purpose !== 'result')
        )
          fail(403, '执行Agent仅可为自己任务提交结果附件');
        this.db
          .prepare(
            'INSERT INTO attachments(id,task_id,name,mime,size,sha256,purpose,created_by,created_at,caption) VALUES(?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            aid,
            id,
            name,
            mime,
            bytes.length,
            hash(bytes),
            purpose,
            actor.id,
            now(),
            text(b.caption ?? '', 1000),
          );
        if (b.acceptanceRunId) bindAcceptanceEvidence(this,actor,t,b,aid);
        this.db
          .prepare(
            'UPDATE tasks SET revision=revision+1,spec_revision=spec_revision+?,updated_at=? WHERE id=?',
          )
          .run(purpose === 'result' ? 0 : 1, now(), id);
        // Reference attachments advance the requirements version; the direct
        // queue has no plan revision to invalidate.
        this.event(id, actor.id, 'attachment.added', {
          id: aid,
          name,
          purpose,
        });
        return this.detail(id);
      });
    } catch (e) {
      fs.unlinkSync(filename);
      throw e;
    }
  }
  attachment(id) {
    const f = this.db.prepare('SELECT * FROM attachments WHERE id=?').get(id);
    if (!f) fail(404, '附件不存在');
    return { ...f, path: path.join(this.dir, 'attachments', f.id) };
  }
  removeAttachment(actor, id, revision) {
    return this.transaction(() => {
      const f = this.attachment(id),
        t = this.get(f.task_id);
      if (actor.role !== 'human') fail(403, '仅用户可移除附件');
      if (t.status === 'archived') fail(409, '归档任务只读');
      if (t.revision !== revision) fail(409, '任务已更新');
      if (f.retired_at) fail(409, '附件已标记替代');
      this.db
        .prepare('UPDATE attachments SET retired_at=? WHERE id=?')
        .run(now(), id);
      this.db
        .prepare(
          'UPDATE tasks SET revision=revision+1,spec_revision=spec_revision+?,updated_at=? WHERE id=?',
        )
        .run(f.purpose === 'result' ? 0 : 1, now(), t.id);
      this.event(t.id, actor.id, 'attachment.retired', { id, name: f.name });
      return this.detail(t.id);
    });
  }
}

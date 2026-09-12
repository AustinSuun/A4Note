import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://aster:aster_dev_password@localhost:5432/aster';
const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_SECONDS || 2_592_000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': CORS_ORIGIN, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', ...headers });
  res.end(JSON.stringify(body));
};

const error = (res, status, code, message, details) => json(res, status, { error: { code, message, ...(details ? { details } : {}) } });

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function token() { return crypto.randomBytes(32).toString('base64url'); }
function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(`scrypt$${salt}$${key.toString('hex')}`)));
}
function verifyPassword(password, stored) {
  const [, salt, expected] = String(stored).split('$');
  if (!salt || !expected) return Promise.resolve(false);
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => {
    if (err) return reject(err);
    const actual = key.toString('hex');
    resolve(actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected)));
  }));
}
function validUsername(value) { return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(value); }
function validText(value, max) { return typeof value === 'string' && value.length <= max; }
function publicUser(row) { return { id: row.id, username: row.username, nickname: row.nickname }; }
function note(row) { return { id: row.id, paperId: row.paper_id, title: row.title, content: row.content, format: row.format, version: Number(row.version), createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at }; }

async function issueTokens(client, userId, platform = 'unknown', deviceName = 'Unknown device') {
  const device = await client.query('INSERT INTO devices(user_id, name, platform) VALUES ($1,$2,$3) RETURNING id', [userId, deviceName, platform]);
  const access = token();
  const refresh = token();
  const expires = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);
  await client.query('INSERT INTO access_tokens(token_hash,user_id,device_id,expires_at) VALUES ($1,$2,$3,$4)', [hash(access), userId, device.rows[0].id, expires]);
  await client.query('INSERT INTO refresh_tokens(user_id,device_id,token_hash,expires_at) VALUES ($1,$2,$3,$4)', [userId, device.rows[0].id, hash(refresh), new Date(Date.now() + 90 * 86400000)]);
  return { accessToken: access, refreshToken: refresh, expiresIn: TOKEN_TTL_SECONDS, deviceId: device.rows[0].id };
}

async function issueAccessToken(client, userId, deviceId) {
  const access = token();
  await client.query('INSERT INTO access_tokens(token_hash,user_id,device_id,expires_at) VALUES ($1,$2,$3,$4)', [hash(access), userId, deviceId, new Date(Date.now() + TOKEN_TTL_SECONDS * 1000)]);
  return access;
}

async function auth(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const result = await pool.query('SELECT u.*, d.id AS device_id FROM access_tokens a JOIN users u ON u.id=a.user_id JOIN devices d ON d.id=a.device_id WHERE a.token_hash=$1 AND a.expires_at > now() AND d.revoked_at IS NULL AND u.status=$2', [hash(header.slice(7)), 'active']);
  if (!result.rowCount) return null;
  await pool.query('UPDATE devices SET last_seen_at=now() WHERE id=$1', [result.rows[0].device_id]);
  return result.rows[0];
}

async function register(req, res) {
  const input = await body(req);
  if (!validUsername(input.username) || !validText(input.nickname, 64) || input.nickname.trim().length < 1 || typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 128) return error(res, 400, 'INVALID_INPUT', 'username、nickname 或 password 格式不正确');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const password = await passwordHash(input.password);
    const result = await client.query('INSERT INTO users(username,nickname,password_hash) VALUES ($1,$2,$3) RETURNING id,username,nickname', [input.username, input.nickname.trim(), password]);
    const tokens = await issueTokens(client, result.rows[0].id, input.platform || 'unknown', input.deviceName || 'Unknown device');
    await client.query('COMMIT');
    return json(res, 201, { ...tokens, user: publicUser(result.rows[0]) });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return error(res, 409, 'USERNAME_TAKEN', '用户名已存在');
    throw e;
  } finally { client.release(); }
}

async function login(req, res) {
  const input = await body(req);
  if (typeof input.username !== 'string' || typeof input.password !== 'string') return error(res, 400, 'INVALID_INPUT', '用户名和密码不能为空');
  const result = await pool.query('SELECT * FROM users WHERE username=$1', [input.username]);
  if (!result.rowCount || !(await verifyPassword(input.password, result.rows[0].password_hash))) return error(res, 401, 'INVALID_CREDENTIALS', '用户名或密码错误');
  const client = await pool.connect();
  try { const tokens = await issueTokens(client, result.rows[0].id, input.platform || 'unknown', input.deviceName || 'Unknown device'); return json(res, 200, { ...tokens, user: publicUser(result.rows[0]) }); } finally { client.release(); }
}

async function refresh(req, res) {
  const input = await body(req);
  if (typeof input.refreshToken !== 'string' || !input.refreshToken) return error(res, 400, 'INVALID_INPUT', 'refreshToken 不能为空');
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT r.user_id, r.device_id FROM refresh_tokens r JOIN users u ON u.id=r.user_id JOIN devices d ON d.id=r.device_id WHERE r.token_hash=$1 AND r.expires_at>now() AND r.revoked_at IS NULL AND u.status=$2 AND d.revoked_at IS NULL', [hash(input.refreshToken), 'active']);
    if (!result.rowCount) return error(res, 401, 'INVALID_REFRESH_TOKEN', '刷新令牌无效或已过期');
    const accessToken = await issueAccessToken(client, result.rows[0].user_id, result.rows[0].device_id);
    await client.query('UPDATE devices SET last_seen_at=now() WHERE id=$1', [result.rows[0].device_id]);
    return json(res, 200, { accessToken, expiresIn: TOKEN_TTL_SECONDS });
  } finally { client.release(); }
}

async function logout(req, res, user) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) await pool.query('DELETE FROM access_tokens WHERE token_hash=$1', [hash(header.slice(7))]);
  await pool.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND device_id=$2 AND revoked_at IS NULL', [user.id, user.device_id]);
  return json(res, 200, { loggedOut: true });
}

async function listNotes(req, res, user) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 100);
  const after = url.searchParams.get('updated_after');
  const values = [user.id];
  let where = 'user_id=$1 AND deleted_at IS NULL';
  if (after) { values.push(after); where += ' AND updated_at > $2'; }
  values.push(limit);
  const result = await pool.query(`SELECT * FROM notes WHERE ${where} ORDER BY updated_at DESC LIMIT $${values.length}`, values);
  return json(res, 200, { notes: result.rows.map(note), hasMore: result.rowCount === limit });
}

async function createNote(req, res, user) {
  const input = await body(req);
  if (!validText(input.title, 256) || !validText(input.content, 1024 * 1024)) return error(res, 400, 'INVALID_INPUT', '笔记字段不合法');
  const id = input.id || crypto.randomUUID();
  const client = await pool.connect();
  try { await client.query('BEGIN'); const row = await client.query('INSERT INTO notes(id,user_id,paper_id,title,content,format) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [id, user.id, input.paperId || null, input.title || '', input.content || '', input.format || 'markdown']); await client.query('INSERT INTO sync_changes(user_id,entity_id,operation,version) VALUES ($1,$2,$3,$4)', [user.id, id, 'upsert', 1]); await client.query('COMMIT'); return json(res, 201, { note: note(row.rows[0]) }); } catch (e) { await client.query('ROLLBACK'); if (e.code === '23505') return error(res, 409, 'NOTE_EXISTS', '笔记已存在'); throw e; } finally { client.release(); }
}

async function updateNote(req, res, user, id) {
  const input = await body(req);
  if (!validText(input.title, 256) || !validText(input.content, 1024 * 1024)) return error(res, 400, 'INVALID_INPUT', '笔记字段不合法');
  const client = await pool.connect();
  try { await client.query('BEGIN'); const current = await client.query('SELECT * FROM notes WHERE user_id=$1 AND id=$2 FOR UPDATE', [user.id, id]); if (!current.rowCount) { await client.query('ROLLBACK'); return error(res, 404, 'NOTE_NOT_FOUND', '笔记不存在'); } const row = current.rows[0]; if (input.baseVersion !== undefined && Number(input.baseVersion) !== Number(row.version)) { await client.query('ROLLBACK'); return error(res, 409, 'VERSION_CONFLICT', '笔记版本冲突', { current: note(row) }); } const next = await client.query('UPDATE notes SET title=$1,content=$2,format=$3,paper_id=$4,version=version+1,updated_at=now() WHERE user_id=$5 AND id=$6 RETURNING *', [input.title ?? row.title, input.content ?? row.content, input.format || row.format, input.paperId ?? row.paper_id, user.id, id]); await client.query('INSERT INTO sync_changes(user_id,entity_id,operation,version) VALUES ($1,$2,$3,$4)', [user.id, id, 'upsert', next.rows[0].version]); await client.query('COMMIT'); return json(res, 200, { note: note(next.rows[0]) }); } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

async function deleteNote(req, res, user, id) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const row = await client.query('UPDATE notes SET deleted_at=now(),version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING *', [user.id, id]); if (!row.rowCount) { await client.query('ROLLBACK'); return error(res, 404, 'NOTE_NOT_FOUND', '笔记不存在'); } await client.query('INSERT INTO sync_changes(user_id,entity_id,operation,version) VALUES ($1,$2,$3,$4)', [user.id, id, 'delete', row.rows[0].version]); await client.query('COMMIT'); return json(res, 200, { deleted: true, id, version: Number(row.rows[0].version) }); } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

async function pull(req, res, user) {
  const url = new URL(req.url, `http://${req.headers.host}`); const cursor = Math.max(Number(url.searchParams.get('cursor') || 0), 0); const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
  const result = await pool.query('SELECT c.*, n.* FROM sync_changes c LEFT JOIN notes n ON n.user_id=c.user_id AND n.id=c.entity_id WHERE c.user_id=$1 AND c.sequence>$2 ORDER BY c.sequence ASC LIMIT $3', [user.id, cursor, limit]);
  const changes = result.rows.map(row => ({ entity: row.entity_type, entityId: row.entity_id, operation: row.operation, version: Number(row.version), data: row.operation === 'delete' ? null : note(row) }));
  return json(res, 200, { cursor: result.rowCount ? result.rows[result.rowCount - 1].sequence.toString() : String(cursor), hasMore: result.rowCount === limit, changes });
}

async function push(req, res, user) {
  const input = await body(req); if (!Array.isArray(input.operations) || input.operations.length > 100) return error(res, 400, 'INVALID_INPUT', 'operations 必须是最多 100 项的数组');
  const client = await pool.connect(); const results = [];
  try { await client.query('BEGIN'); for (const op of input.operations) { if (!op.operationId || op.entity !== 'note' || !op.entityId || !['upsert', 'delete'].includes(op.operation)) { results.push({ operationId: op.operationId, status: 'rejected', code: 'INVALID_OPERATION' }); continue; } const previous = await client.query('SELECT result FROM sync_operations WHERE user_id=$1 AND operation_id=$2', [user.id, op.operationId]); if (previous.rowCount) { results.push(previous.rows[0].result); continue; } const current = await client.query('SELECT * FROM notes WHERE user_id=$1 AND id=$2 FOR UPDATE', [user.id, op.entityId]); if (op.operation === 'upsert' && current.rowCount && op.baseVersion !== undefined && Number(op.baseVersion) !== Number(current.rows[0].version)) { const conflict = { operationId: op.operationId, status: 'conflict', code: 'VERSION_CONFLICT', current: note(current.rows[0]) }; await client.query('INSERT INTO sync_operations(user_id,operation_id,result) VALUES ($1,$2,$3)', [user.id, op.operationId, conflict]); results.push(conflict); continue; } const payload = op.payload || {}; let row; if (op.operation === 'delete') { if (!current.rowCount) { const missing = { operationId: op.operationId, status: 'accepted', operation: 'delete', version: 0 }; results.push(missing); continue; } row = await client.query('UPDATE notes SET deleted_at=now(),version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *', [user.id, op.entityId]); } else if (current.rowCount) { row = await client.query('UPDATE notes SET title=$1,content=$2,format=$3,paper_id=$4,deleted_at=NULL,version=version+1,updated_at=now() WHERE user_id=$5 AND id=$6 RETURNING *', [payload.title || '', payload.content || '', payload.format || 'markdown', payload.paperId || null, user.id, op.entityId]); } else { row = await client.query('INSERT INTO notes(id,user_id,paper_id,title,content,format) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [op.entityId, user.id, payload.paperId || null, payload.title || '', payload.content || '', payload.format || 'markdown']); } const saved = { operationId: op.operationId, status: 'accepted', operation: op.operation, version: Number(row.rows[0].version), note: note(row.rows[0]) }; await client.query('INSERT INTO sync_changes(user_id,entity_id,operation,version) VALUES ($1,$2,$3,$4)', [user.id, op.entityId, op.operation, row.rows[0].version]); await client.query('INSERT INTO sync_operations(user_id,operation_id,result) VALUES ($1,$2,$3)', [user.id, op.operationId, saved]); results.push(saved); } await client.query('COMMIT'); return json(res, 200, { results }); } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

async function migrate() { const sql = await fs.readFile(path.join(root, 'db', '001_init.sql'), 'utf8'); await pool.query(sql); }

async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.url === '/healthz' && req.method === 'GET') { try { await pool.query('SELECT 1'); return json(res, 200, { ok: true }); } catch { return error(res, 503, 'DATABASE_UNAVAILABLE', '数据库不可用'); } }
  const url = new URL(req.url, `http://${req.headers.host}`); const route = url.pathname;
  try {
    if (route === '/api/v1/auth/register' && req.method === 'POST') return await register(req, res);
    if (route === '/api/v1/auth/login' && req.method === 'POST') return await login(req, res);
    if (route === '/api/v1/auth/refresh' && req.method === 'POST') return await refresh(req, res);
    const user = await auth(req); if (!user) return error(res, 401, 'UNAUTHORIZED', '需要登录');
    if (route === '/api/v1/auth/logout' && req.method === 'POST') return logout(req, res, user);
    if (route === '/api/v1/me' && req.method === 'GET') return json(res, 200, { user: publicUser(user) });
    if (route === '/api/v1/notes' && req.method === 'GET') return listNotes(req, res, user);
    if (route === '/api/v1/notes' && req.method === 'POST') return createNote(req, res, user);
    if (route === '/api/v1/sync/pull' && req.method === 'GET') return pull(req, res, user);
    if (route === '/api/v1/sync/push' && req.method === 'POST') return push(req, res, user);
    const match = route.match(/^\/api\/v1\/notes\/([^/]+)$/); if (match && req.method === 'PATCH') return updateNote(req, res, user, match[1]); if (match && req.method === 'DELETE') return deleteNote(req, res, user, match[1]);
    return error(res, 404, 'NOT_FOUND', '接口不存在');
  } catch (e) { console.error(`[${new Date().toISOString()}]`, e); return error(res, e.status || 500, e.status ? 'REQUEST_ERROR' : 'INTERNAL_ERROR', e.status ? e.message : '服务器内部错误'); }
}

await migrate();
http.createServer(handler).listen(PORT, () => console.log(`Aster sync API listening on :${PORT}`));

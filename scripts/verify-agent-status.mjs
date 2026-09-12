import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const handbook = await readFile('docs/notes/DEVELOPMENT_HANDBOOK.md', 'utf8');
const statusMarkdown = await readFile('docs/notes/AGENT_STATUS.md', 'utf8');
const agentEntry = await readFile('AGENTS.md', 'utf8');
const rawStatus = await readFile('plans/PROJECT_STATUS.json', 'utf8');
const status = JSON.parse(rawStatus);

assert.equal(status.schemaVersion, 1, 'Agent status schema version must be 1');
assert.match(status.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'Agent status must include an ISO timestamp');
assert.equal(typeof status.activePlan, 'string');
assert.equal(typeof status.activeWork?.status, 'string');
assert.ok(Array.isArray(status.activeWork?.scope), 'Active work must list its scope');
assert.ok(status.tracks && typeof status.tracks === 'object', 'Agent status must include tracks');
assert.ok(Object.keys(status.tracks).length >= 5, 'Agent status must describe the major work tracks');
assert.ok(['backlog', 'in_progress', 'review', 'done', 'blocked'].includes(status.activeWork.status));
assert.ok(Array.isArray(status.lastHandoff?.completed));
assert.ok(Array.isArray(status.lastHandoff?.verification));
assert.ok(Array.isArray(status.lastHandoff?.next));
assert.match(handbook, /AGENT_STATUS\.md/);
assert.match(handbook, /PROJECT_STATUS\.json/);
assert.match(agentEntry, /DEVELOPMENT_HANDBOOK\.md/);
assert.match(agentEntry, /npm run status/);
assert.match(agentEntry, /PROJECT_STATUS\.json/);
assert.match(statusMarkdown, /更新时间：/);
assert.match(statusMarkdown, /## 当前工作/);

console.log('Agent status verification passed');

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { resolveDataDir, normalizeRoot, dataDirName, projectsHome } from '../lib/data-dir.mjs';

const human = { id: 'human', alias: '你', role: 'human' };
const legacyName = (root) => createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);
const withTasks = (dir, count, projectRoot) => {
  const store = new Store(dir, '数据目录项目');
  for (let i = 0; i < count; i++) store.create(human, { title: '任务 ' + i });
  store.close();
  fs.writeFileSync(path.join(dir, 'connection.json'), JSON.stringify({ url: 'http://127.0.0.1:4319', projectRoot, pid: 1 }), { mode: 0o600 });
};

test('private data directory resolution reuses existing project data across root spellings', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'data-dir-home-'));
  const base = projectsHome(home);
  fs.mkdirSync(base, { recursive: true });
  try {
    const root = process.platform === 'win32' ? 'C:/Aster Data/Proj' : path.join(home, 'Proj');
    const otherCase = process.platform === 'win32' ? 'c:/aster data/proj' : path.join(home, 'Proj') + '/';
    assert.equal(normalizeRoot(root), normalizeRoot(otherCase), 'same project normalizes identically');

    // 没有历史目录时使用规范化键
    const empty = resolveDataDir(root, base);
    assert.equal(empty, path.join(base, dataDirName(root)));

    // 旧拼写产生的目录（含真实任务）必须被复用，而不是新建空看板
    const legacy = path.join(base, legacyName(root));
    withTasks(legacy, 3, root);
    fs.mkdirSync(path.join(base, 'unrelated'), { recursive: true });
    fs.writeFileSync(path.join(base, 'unrelated', 'connection.json'), JSON.stringify({ projectRoot: path.join(home, 'Other'), pid: 2 }));
    const adopted = resolveDataDir(otherCase, base);
    assert.equal(adopted, legacy, '不同拼写复用已有数据目录');
    const reopened = new Store(adopted, '数据目录项目');
    assert.equal(reopened.snapshot().tasks.length, 3, '复用目录保留全部任务');
    reopened.close();

    // 规范化键已有数据时优先使用规范化目录
    const canonical = path.join(base, dataDirName(root));
    withTasks(canonical, 1, root);
    assert.equal(resolveDataDir(otherCase, base), canonical, '规范化目录有数据时优先');

    // 多个匹配目录中选择有数据的，不合并
    const canonical2 = canonical;
    fs.rmSync(canonical2, { recursive: true, force: true });
    const emptyMatch = path.join(base, 'emptymatch0000000');
    fs.mkdirSync(emptyMatch, { recursive: true });
    fs.writeFileSync(path.join(emptyMatch, 'connection.json'), JSON.stringify({ projectRoot: otherCase, pid: 3 }));
    assert.equal(resolveDataDir(root, base), legacy, '空目录不会赢过有数据的目录');
    assert.ok(fs.existsSync(path.join(legacy, 'tasks.sqlite')) && fs.existsSync(path.join(emptyMatch, 'connection.json')), '不合并不删除任何目录');
  } finally {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

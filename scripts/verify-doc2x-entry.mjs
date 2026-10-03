/**
 * Doc2X library entry checks (65aab909).
 *
 * Two halves worth pinning: the guidance text a user sees when a prerequisite
 * is missing, and the wiring that puts the entry into the library context menu
 * and detail panel without reopening the workbench panel. Node test runner:
 * no Tauri, no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  DOC2X_ENTRY_HINT_STORAGE_KEY,
  DOC2X_ENTRY_INSTALL_HINT,
  DOC2X_ENTRY_LOGIN_HINT,
  DOC2X_ENTRY_MIN_NODE_MAJOR,
  describeDoc2xEntryCli,
  describeDoc2xEntryDisabled,
  describeDoc2xEntryFailure,
  describeDoc2xEntryMissingPdf,
  describeDoc2xEntrySuccess,
  doc2xEntryFirstRunHint,
  summarizeDoc2xEntryBatch,
} from '../src/features/doc2x/doc2xEntryPlan.ts';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('a missing CLI explains install and login instead of doing nothing', () => {
  const message = describeDoc2xEntryCli({ available: false, nodeMajor: DOC2X_ENTRY_MIN_NODE_MAJOR });
  assert.ok(message.includes('未检测到 Doc2X CLI'));
  assert.ok(message.includes(DOC2X_ENTRY_INSTALL_HINT));
  assert.ok(message.includes(DOC2X_ENTRY_LOGIN_HINT));
});

test('an old Node is reported before the missing CLI', () => {
  const message = describeDoc2xEntryCli({ available: false, nodeMajor: 18 });
  assert.ok(message.includes(`Node.js ${DOC2X_ENTRY_MIN_NODE_MAJOR}`));
  assert.ok(message.includes('v18'));
});

test('an installed CLI reports its version', () => {
  assert.equal(
    describeDoc2xEntryCli({ available: true, version: '0.2.0', nodeMajor: 22 }),
    '已检测到 Doc2X CLI 0.2.0。',
  );
});

test('auth and quota failures point at the login entry', () => {
  const message = describeDoc2xEntryFailure({
    kind: 'auth',
    message: 'Doc2X 登录已失效、额度或订阅不足，请重新登录或检查账号订阅',
  });
  assert.ok(message.includes(DOC2X_ENTRY_LOGIN_HINT));
  assert.ok(message.includes('登录自有账号'));
});

test('batch summaries stay honest about partial failure', () => {
  const partial = summarizeDoc2xEntryBatch(
    ['译文已回到该文献：a.pdf', 'Doc2X 服务端处理失败，可稍后重试（可重试）'],
    1,
  );
  assert.ok(partial.includes('成功 1 篇'));
  assert.ok(partial.includes('失败 1 篇'));
  assert.ok(partial.includes('首个失败原因'));
  assert.equal(summarizeDoc2xEntryBatch(['译文已回到该文献：a.pdf'], 1), '译文已回到该文献：a.pdf');
});

test('every entry message is user facing Chinese text', () => {
  const messages = [
    describeDoc2xEntryDisabled(),
    describeDoc2xEntryMissingPdf('Test'),
    describeDoc2xEntrySuccess('a.pdf'),
    doc2xEntryFirstRunHint(),
  ];
  for (const message of messages) {
    assert.notEqual(message.trim(), '');
    assert.match(message, /[\u4e00-\u9fff]/);
  }
  assert.equal(DOC2X_ENTRY_HINT_STORAGE_KEY, 'aster.doc2xEntryHintSeen');
});

test('the library exposes the entry in the context menu and the detail panel', async () => {
  const [menu, detail, scene, types] = await Promise.all([
    read('src/features/library/PaperContextMenu.tsx'),
    read('src/features/library/LibraryDetailPanel.tsx'),
    read('src/features/library/LibraryScene.tsx'),
    read('src/features/library/types.ts'),
  ]);
  assert.match(menu, /doc2x\?\.enabled && <button/);
  assert.match(menu, /Doc2X 翻译（本机 CLI）/);
  assert.match(menu, /void doc2x\.onTranslate\(paper\.paperId\)/);
  assert.match(detail, /doc2xEntry\?\.enabled \?/);
  assert.match(detail, /doc2xEntry\.onTranslate\(paper\.paperId\)/);
  assert.match(scene, /doc2xEntry/);
  assert.match(scene, /library-doc2x-notice/);
  assert.match(types, /export type LibraryDoc2xEntry/);
});

test('the host owns the commands so entries work before the panel opens', async () => {
  const [app, panel, host] = await Promise.all([
    read('src/ui/App.tsx'),
    read('src/features/doc2x/Doc2xTranslatePanel.tsx'),
    read('src/features/doc2x/Doc2xCommandHost.tsx'),
  ]);
  assert.match(app, /Doc2xCommandHost/);
  assert.match(app, /useDoc2xLibraryEntry/);
  assert.match(app, /notice: doc2xNotice \|\| doc2xFirstRunHint/);
  // The panel-only install is exactly what left every entry answering 插件未就绪.
  assert.doesNotMatch(panel, /setDoc2xCommandHandlers/);
  assert.match(host, /setDoc2xCommandHandlers/);
});

test('one translate implementation serves the panel and the entries', async () => {
  const [panel, entry] = await Promise.all([
    read('src/features/doc2x/Doc2xTranslatePanel.tsx'),
    read('src/features/doc2x/doc2xEntry.ts'),
  ]);
  assert.match(panel, /translatePaperWithDoc2x\(target, resolution\.settings, root\)/);
  assert.match(entry, /export async function translatePaperWithDoc2x/);
  assert.match(entry, /describeDoc2xEntrySuccess/);
});

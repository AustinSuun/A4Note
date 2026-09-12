/**
 * Behavioural test for the Resource primitives (RES-2) and the registry they
 * back inside the workbench model.
 *
 * Runs the real TypeScript modules through node --experimental-strip-types, so
 * src/core/resources.ts must stay free of runtime imports.
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const res = await import('../src/core/resources.ts');
const model = await import('../src/core/workspace.ts');

let idCounter = 0;
let clock = 0;
const context = {
  createId: (prefix) => `${prefix}-${++idCounter}`,
  now: () => `2026-01-01T00:00:${String(++clock).padStart(2, '0')}.000Z`,
};

// --- URI normalization --------------------------------------------------------
assert.equal(res.normalizeResourceUri('D:\\WorkSpace\\Aster\\main.rs'), 'file:///D:/WorkSpace/Aster/main.rs');
assert.equal(res.normalizeResourceUri('d:/workspace//aster/'), 'file:///D:/workspace/aster');
assert.equal(res.normalizeResourceUri('/home/austin/notes.md'), 'file:///home/austin/notes.md');
assert.equal(res.normalizeResourceUri('\\\\Server\\Share\\paper.pdf'), 'file://server/Share/paper.pdf');
assert.equal(res.normalizeResourceUri('file:///D:/a/b.pdf'), 'file:///D:/a/b.pdf');
assert.equal(res.normalizeResourceUri('file:/D:/a/b.pdf'), 'file:///D:/a/b.pdf');
assert.equal(res.normalizeResourceUri('  '), '', '空输入保持为空，由调用方决定是否算错误');
// A space must be escaped once and stay escaped: the function is its own fixpoint.
const spaced = res.normalizeResourceUri('D:\\My Docs\\a b.pdf');
assert.equal(spaced, 'file:///D:/My%20Docs/a%20b.pdf');
assert.equal(res.normalizeResourceUri(spaced), spaced, 'normalizeResourceUri 必须幂等');
const chinese = res.normalizeResourceUri('D:\\资料\\论文.pdf');
assert.equal(res.normalizeResourceUri(chinese), chinese, '中文路径也必须幂等');
// Scheme and host fold, the default port and a bare trailing slash go, the path stays.
assert.equal(res.normalizeResourceUri('HTTPS://Example.COM:443/Docs/'), 'https://example.com/Docs');
assert.equal(res.normalizeResourceUri('http://example.com:8080/a?b=1#c'), 'http://example.com:8080/a?b=1#c');
assert.equal(res.normalizeResourceUri('http://[::1]:8080/x'), 'http://[::1]:8080/x', 'IPv6 主机不能被端口切断');
assert.equal(res.normalizeResourceUri('ASTER://library/'), 'aster://library');
assert.equal(res.normalizeResourceUri('plugin://zotero/item/42'), 'plugin://zotero/item/42');

// --- identity -----------------------------------------------------------------
assert.ok(res.sameResourceUri('D:\\a\\B.pdf', 'd:/a/b.pdf'), 'Windows 路径大小写不敏感');
assert.ok(!res.sameResourceUri('https://example.com/A', 'https://example.com/a'), 'Web 路径大小写敏感');
assert.equal(res.resourceTabKey('D:\\a\\B.pdf'), 'resource:file:///d:/a/b.pdf');
assert.equal(res.resourceTabKey('d:/a/b.pdf'), res.resourceTabKey('D:\\a\\B.pdf'), '一个路径只能有一个标签键');

// --- kind and title -----------------------------------------------------------
assert.equal(res.inferResourceKind('D:\\a\\paper.PDF'), 'pdf');
assert.equal(res.inferResourceKind('D:\\a\\note.md'), 'markdown');
assert.equal(res.inferResourceKind('D:\\a\\shot.png'), 'image');
assert.equal(res.inferResourceKind('https://example.com/page'), 'web');
assert.equal(res.inferResourceKind('D:\\a\\Makefile'), 'file');
assert.equal(res.inferResourceKind('D:\\a\\src'), 'file', 'folder 不能靠名字猜，只能由调用方声明');
assert.equal(res.inferResourceKind('D:\\a\\src', 'folder'), 'folder');
assert.equal(res.inferResourceKind('   ', 'folder'), 'folder');
assert.equal(res.resourceTitleFromUri('D:\\资料\\论文 A.pdf'), '论文 A.pdf');
assert.equal(res.resourceTitleFromUri('https://example.com'), 'example.com');
assert.ok(res.isResourceKind('plugin:zotero'));
assert.ok(!res.isResourceKind('nonsense'));

// --- local path round trip ----------------------------------------------------
assert.equal(res.localPathFromResourceUri('file:///D:/a/b.pdf'), 'D:\\a\\b.pdf');
assert.equal(res.localPathFromResourceUri(res.normalizeResourceUri('D:\\资料\\论文.pdf')), 'D:\\资料\\论文.pdf');
assert.equal(res.localPathFromResourceUri('file://server/Share/x.pdf'), '\\\\server\\Share\\x.pdf');
assert.equal(res.localPathFromResourceUri('file:///home/a/n.md'), '/home/a/n.md');
assert.equal(res.localPathFromResourceUri('https://example.com/a.pdf'), null, '只有 file: 才有本地路径');

// --- registry -----------------------------------------------------------------
let state = model.createProject(model.createWorkbenchState(), { rootPath: 'D:\\WorkSpace\\Aster' }, context).state;
const projectId = state.projects[0].id;
const workspaceId = state.workspaces[0].id;

const first = model.registerResource(state, { uri: 'D:\\WorkSpace\\Aster\\main.rs', projectId }, context);
state = first.state;
assert.equal(first.resource.uri, 'file:///D:/WorkSpace/Aster/main.rs');
assert.equal(first.resource.kind, 'file');
assert.equal(first.resource.title, 'main.rs', '没有标题时从 URI 末段推断');
assert.equal(state.resources.length, 1);

// Another spelling of the same path is the same record, not a second one.
const again = model.registerResource(state, { uri: 'd:/workspace/aster/main.rs' }, context);
assert.equal(again.state, state, '重复注册且无新信息时不应写状态');
assert.equal(again.resource.id, first.resource.id);
assert.equal(model.findResourceByUri(state, 'D:/WorkSpace/Aster/MAIN.RS').id, first.resource.id);

// A later registration fills in what the first one did not know.
const enriched = model.registerResource(state, { uri: 'd:/workspace/aster/main.rs', title: '入口', metadata: { lines: 42 } }, context);
state = enriched.state;
assert.equal(state.resources.length, 1);
assert.equal(enriched.resource.title, '入口');
assert.deepEqual(enriched.resource.metadata, { lines: 42 });
assert.notEqual(enriched.resource.updatedAt, enriched.resource.createdAt);
assert.equal(model.registerResource(state, { uri: '   ' }, context).resource, null, '空 URI 不产生记录');

const web = model.registerResource(state, { uri: 'https://example.com/spec' }, context);
state = web.state;
assert.equal(web.resource.kind, 'web');
assert.equal(web.resource.projectId, undefined, '不带项目的资源是工作台级的');
assert.equal(model.resourcesForProject(state, projectId).length, 1);

// --- update -------------------------------------------------------------------
state = model.updateResource(state, first.resource.id, { title: '  入口文件  ', metadata: { lines: 43 } }, context);
assert.equal(model.findResource(state, first.resource.id).title, '入口文件');
assert.deepEqual(model.findResource(state, first.resource.id).metadata, { lines: 43 });
assert.equal(model.updateResource(state, first.resource.id, {}, context), state, '空补丁不应写状态');
assert.equal(model.updateResource(state, first.resource.id, { title: '   ' }, context), state, '空标题不应写状态');
assert.equal(model.updateResource(state, 'missing', { title: 'x' }, context), state);
// `uri` is not part of ResourcePatch; a different URI is a different resource.
const attempted = model.updateResource(state, first.resource.id, { uri: 'D:/other.rs' }, context);
assert.equal(model.findResource(attempted, first.resource.id).uri, 'file:///D:/WorkSpace/Aster/main.rs');

// --- tab binding --------------------------------------------------------------
const uri = first.resource.uri;
const opened = model.openTab(
  state,
  workspaceId,
  { kind: 'file', key: res.resourceTabKey(uri), title: 'main.rs', resourceId: first.resource.id, state: { path: 'D:\\WorkSpace\\Aster\\main.rs' } },
  context,
);
state = opened.state;
assert.equal(opened.tab.resourceId, first.resource.id);

// The same file under a different spelling focuses the tab that is already open.
const reopened = model.openTab(
  state,
  workspaceId,
  { kind: 'file', key: res.resourceTabKey('d:/workspace/aster/main.rs'), title: 'main.rs' },
  context,
);
state = reopened.state;
assert.equal(reopened.tab.id, opened.tab.id, '同一个文件的两种写法只能有一个标签');
assert.equal(model.orderedTabs(model.findWorkspace(state, workspaceId)).length, 1);

// Removing the record unbinds the tab instead of closing it: the tab still knows its path.
const unbound = model.removeResource(state, first.resource.id);
assert.equal(model.findResource(unbound, first.resource.id), null);
assert.equal(model.findTab(unbound, opened.tab.id).tab.resourceId, undefined);
assert.deepEqual(model.findTab(unbound, opened.tab.id).tab.state, { path: 'D:\\WorkSpace\\Aster\\main.rs' });
assert.equal(model.removeResource(state, 'missing'), state);

// Deleting a project takes its resources and their bindings, and leaves global ones.
const cascade = model.removeProject(state, projectId);
assert.equal(cascade.resources.length, 1);
assert.equal(cascade.resources[0].id, web.resource.id, '工作台级资源不随项目消失');

// --- serialize / restore ------------------------------------------------------
const restored = model.deserializeWorkbenchState(model.serializeWorkbenchState(state));
assert.deepEqual(restored.resources, state.resources);
assert.equal(model.findTab(restored, opened.tab.id).tab.resourceId, first.resource.id);

// Orphans, duplicates and dead bindings are repaired instead of crashing the shell.
const repaired = model.normalizeWorkbenchState({
  version: 1,
  projects: [{ id: 'p1', rootPath: 'D:/one', createdAt: 'now' }],
  workspaces: [
    { id: 'w1', projectId: 'p1', createdAt: 'now', tabs: [
      { id: 't1', kind: 'file', key: 'file:D:\\one\\a.md', resourceId: 'r1' },
      { id: 't2', kind: 'file', key: 'file:d:/one/a.md', resourceId: 'r1' },
      { id: 't3', kind: 'file', key: 'file:D:\\one\\b.md', resourceId: 'gone' },
    ] },
  ],
  resources: [
    { id: 'r1', projectId: 'p1', uri: 'D:\\one\\a.md', createdAt: 'now' },
    { id: 'r1-twin', projectId: 'p1', uri: 'd:/one/a.md', createdAt: 'now' },
    { id: 'r2', projectId: 'ghost', uri: 'D:\\ghost\\x.md', createdAt: 'now' },
    { id: 'r3', uri: '   ' },
    { nope: true },
  ],
  agentSessions: [],
});
assert.deepEqual(repaired.resources.map((resource) => resource.id), ['r1'], '重复 URI、孤儿项目和空 URI 都被丢弃');
assert.equal(repaired.resources[0].uri, 'file:///D:/one/a.md', '恢复时 URI 也要规范化');
assert.equal(repaired.resources[0].kind, 'markdown');
assert.equal(repaired.resources[0].title, 'a.md');
assert.equal(repaired.resources[0].updatedAt, 'now', '缺失的 updatedAt 回落到 createdAt');
// Two legacy keys for one path collapse onto one tab, and a dead binding is only unbound.
assert.deepEqual(repaired.workspaces[0].tabs.map((tab) => tab.id), ['t1', 't3']);
assert.equal(repaired.workspaces[0].tabs[0].key, 'resource:file:///d:/one/a.md');
assert.equal(repaired.workspaces[0].tabs[0].resourceId, 'r1');
assert.equal(repaired.workspaces[0].tabs[1].resourceId, undefined, '资源没了标签只解绑，不关闭');
assert.deepEqual(repaired.workspaces[0].tabs.map((tab) => tab.order), [0, 1]);

// --- storage adapter ----------------------------------------------------------
const store = await import('../src/workbench/workspaceStore.ts');
const writes = [];
const wired = store.createWorkbenchStore({ read: () => null, write: (value) => writes.push(value) });
const wiredProject = wired.createProject({ rootPath: 'D:/one' });
const registered = wired.registerResource({ uri: 'D:\\one\\a.md', projectId: wiredProject.id });
assert.equal(registered.kind, 'markdown');
assert.equal(wired.getState().resources.length, 1);
const writeCount = writes.length;
wired.registerResource({ uri: 'd:/one/a.md' });
assert.equal(writes.length, writeCount, '重复注册不应重复写快照');
wired.updateResource(registered.id, { title: '说明' });
assert.equal(model.deserializeWorkbenchState(writes[writes.length - 1]).resources[0].title, '说明');
wired.removeResource(registered.id);
assert.deepEqual(wired.getState().resources, []);

console.log('verify-resource-model: ok');

/**
 * Behavioural test for the pure workbench model (PWS-0) and its storage
 * adapter (PWS-1).
 *
 * Runs the real TypeScript modules through node --experimental-strip-types, so
 * src/core/workspace.ts must stay free of runtime imports.
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

/* The app's relative imports are extensionless (Vite/tsc resolve them); node's
   ESM resolver does not, so point bare relative specifiers at their .ts file. */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const model = await import('../src/core/workspace.ts');

let idCounter = 0;
let clock = 0;
const context = {
  createId: (prefix) => `${prefix}-${++idCounter}`,
  now: () => `2026-01-01T00:00:${String(++clock).padStart(2, '0')}.000Z`,
};

// --- projects -----------------------------------------------------------------
let state = model.createWorkbenchState();
assert.equal(state.version, model.WORKBENCH_STATE_VERSION);
assert.deepEqual(state.projects, []);
assert.deepEqual(state.resources, [], '新工作台没有资源记录');

const created = model.createProject(state, { rootPath: 'D:\\WorkSpace\\Aster' }, context);
state = created.state;
assert.equal(created.project.name, 'Aster');
assert.equal(created.project.kind, 'folder');
assert.equal(state.projects.length, 1);
assert.equal(state.workspaces.length, 1, '创建项目时应播种一个默认工作区');
assert.equal(state.workspaces[0].name, '默认工作区');
assert.equal(state.activeProjectId, created.project.id);
assert.equal(state.activeWorkspaceId, state.workspaces[0].id);

// Same folder, different casing and trailing separator: no duplicate project.
const again = model.createProject(state, { rootPath: 'd:/workspace/aster/' }, context);
assert.equal(again.project.id, created.project.id);
assert.equal(again.state.projects.length, 1);
assert.equal(again.state.workspaces.length, 1);

const second = model.createProject(state, { rootPath: 'D:\\WorkSpace\\Other' }, context);
state = second.state;
assert.equal(state.projects.length, 2);
assert.equal(state.activeProjectId, second.project.id);

state = model.renameProject(state, second.project.id, '  论文库  ', context);
assert.equal(model.findProject(state, second.project.id).name, '论文库');
assert.equal(model.renameProject(state, second.project.id, '   ', context), state, '空名称不应改变状态');

// --- workspaces ---------------------------------------------------------------
const extra = model.createWorkspace(state, { projectId: created.project.id }, context);
state = extra.state;
assert.equal(extra.workspace.name, '工作区 2');
assert.equal(state.activeProjectId, created.project.id);
assert.equal(state.activeWorkspaceId, extra.workspace.id);
assert.equal(model.workspacesForProject(state, created.project.id).length, 2);

const mainWorkspaceId = model.workspacesForProject(state, created.project.id)[0].id;
state = model.activateWorkspace(state, mainWorkspaceId, context);
assert.equal(state.activeWorkspaceId, mainWorkspaceId);

state = model.setWorkspaceLayout(state, mainWorkspaceId, { fileTreeVisible: true }, context);
assert.deepEqual(model.findWorkspace(state, mainWorkspaceId).layout, {
  fileTreeVisible: true,
  rightDrawerVisible: false,
});

// --- tabs ---------------------------------------------------------------------
const openReader = model.openTab(state, mainWorkspaceId, { kind: 'pdf', key: 'pdf:1', title: '论文 A' }, context);
state = openReader.state;
const readerTabId = openReader.tab.id;
assert.equal(model.activeTab(state).id, readerTabId);

const openNote = model.openTab(state, mainWorkspaceId, { kind: 'markdown', key: 'md:1', title: '笔记' }, context);
state = openNote.state;
const noteTabId = openNote.tab.id;
assert.equal(model.findWorkspace(state, mainWorkspaceId).activeTabId, noteTabId);

// Same key focuses the existing tab instead of duplicating it.
const reopen = model.openTab(state, mainWorkspaceId, { kind: 'pdf', key: 'pdf:1', title: '论文 A' }, context);
state = reopen.state;
assert.equal(reopen.tab.id, readerTabId);
assert.equal(model.orderedTabs(model.findWorkspace(state, mainWorkspaceId)).length, 2);
assert.equal(model.findWorkspace(state, mainWorkspaceId).activeTabId, readerTabId);

// Reopening a legacy resource tab may add missing plugin routing metadata, but
// must not overwrite an existing binding if another opener claims the same URI.
state = model.updateTabState(state, readerTabId, { uri: 'file:///D:/notes/paper.pdf' }, context);
const migrated = model.openTab(state, mainWorkspaceId, {
  kind: 'pdf',
  key: 'pdf:1',
  title: 'Paper A',
  state: { sceneId: 'reader', openerId: 'reader.pdf', uri: 'file:///D:/notes/paper.pdf' },
}, context);
state = migrated.state;
assert.deepEqual(
  model.findTab(state, readerTabId).tab.state,
  { uri: 'file:///D:/notes/paper.pdf', sceneId: 'reader', openerId: 'reader.pdf' },
  'legacy resource tabs should gain missing scene/opener metadata',
);
const preserved = model.openTab(state, mainWorkspaceId, {
  kind: 'pdf',
  key: 'pdf:1',
  title: 'Paper A',
  state: { sceneId: 'other.scene', openerId: 'plugin:other.pdf', uri: 'file:///D:/notes/other.pdf' },
}, context);
assert.equal(preserved.tab.state.sceneId, 'reader', 'existing scene binding must remain authoritative');
assert.equal(preserved.tab.state.openerId, 'reader.pdf', 'existing opener binding must remain authoritative');
assert.equal(preserved.tab.state.uri, 'file:///D:/notes/paper.pdf', 'existing URI binding must remain authoritative');

const openThird = model.openTab(state, mainWorkspaceId, { kind: 'file', key: 'file:1', title: 'main.rs' }, context);
state = openThird.state;
assert.deepEqual(
  model.orderedTabs(model.findWorkspace(state, mainWorkspaceId)).map((tab) => tab.key),
  ['pdf:1', 'md:1', 'file:1'],
);

state = model.setTabPinned(state, openThird.tab.id, true, context);
assert.deepEqual(
  model.orderedTabs(model.findWorkspace(state, mainWorkspaceId)).map((tab) => tab.key),
  ['file:1', 'pdf:1', 'md:1'],
  '固定标签排在前面',
);
assert.deepEqual(
  model.orderedTabs(model.findWorkspace(state, mainWorkspaceId)).map((tab) => tab.order),
  [0, 1, 2],
  'order 应重新编号',
);

state = model.moveTab(state, readerTabId, 2, context);
assert.deepEqual(
  model.orderedTabs(model.findWorkspace(state, mainWorkspaceId)).map((tab) => tab.key),
  ['file:1', 'md:1', 'pdf:1'],
);

state = model.renameTab(state, noteTabId, '阅读笔记', context);
assert.equal(model.findTab(state, noteTabId).tab.title, '阅读笔记');

state = model.updateTabState(state, readerTabId, { page: 4 }, context);
state = model.updateTabState(state, readerTabId, { zoom: 1.25 }, context);
assert.deepEqual(model.findTab(state, readerTabId).tab.state, {
  uri: 'file:///D:/notes/paper.pdf',
  sceneId: 'reader',
  openerId: 'reader.pdf',
  page: 4,
  zoom: 1.25,
});

// Closing the active tab activates its right neighbour, else the left one.
state = model.setActiveTab(state, noteTabId, context);
state = model.closeTab(state, noteTabId, context);
assert.equal(model.findWorkspace(state, mainWorkspaceId).activeTabId, readerTabId, '关闭活动标签后激活右侧邻居');
assert.equal(model.findTab(state, noteTabId), null);

state = model.closeTab(state, readerTabId, context);
assert.equal(model.findWorkspace(state, mainWorkspaceId).activeTabId, openThird.tab.id);

// --- agent sessions -----------------------------------------------------------
const session = model.createAgentSession(state, { workspaceId: mainWorkspaceId, providerId: 'codex' }, context);
state = session.state;
assert.equal(session.session.projectId, created.project.id);
assert.equal(session.session.workingDirectory, 'D:\\WorkSpace\\Aster', '默认工作目录取项目根路径');
assert.equal(session.session.permissionMode, 'default', 'fullAccess 必须由用户显式选择');
assert.equal(session.session.status, 'idle');
assert.equal(model.createAgentSession(state, { workspaceId: 'missing', providerId: 'codex' }, context).session, null);

const agentTab = model.openTab(
  state,
  mainWorkspaceId,
  { kind: 'agent', key: `agent:${session.session.id}`, title: 'Codex', sessionId: session.session.id },
  context,
);
state = agentTab.state;

// Session lifecycle, not turn lifecycle: `idle -> running` is legal because a
// live process takes the next turn without another handshake, and `running ->
// idle` is what turn completion looks like. Liveness is the supervisor's
// knowledge, so the model only rejects nonsense.
assert.equal(model.canTransitionAgentSession('idle', 'running'), true);
assert.equal(model.canTransitionAgentSession('idle', 'starting'), true);
assert.equal(model.canTransitionAgentSession('running', 'idle'), true, 'running -> idle 就是回合结束');
assert.equal(model.canTransitionAgentSession('idle', 'closed'), true);
assert.equal(model.canTransitionAgentSession('closed', 'starting'), true, '关闭后可以恢复会话');
assert.equal(model.canTransitionAgentSession('running', 'running'), true);
assert.equal(model.canTransitionAgentSession('closed', 'running'), false, '关闭的会话没有进程可以直接跑');
assert.equal(model.canTransitionAgentSession('failed', 'running'), false);

const illegal = model.updateAgentSession(state, session.session.id, { status: 'completed' }, context);
assert.equal(illegal, state, 'completed 是回合状态而不是会话状态，写入会被拒绝');

state = model.updateAgentSession(state, session.session.id, { status: 'starting' }, context);
state = model.updateAgentSession(state, session.session.id, { status: 'running', providerSessionId: 'codex-abc' }, context);
assert.equal(model.findAgentSession(state, session.session.id).status, 'running');
assert.equal(model.findAgentSession(state, session.session.id).providerSessionId, 'codex-abc');
assert.equal(model.agentSessionsForWorkspace(state, mainWorkspaceId).length, 1);

// A turn that ends leaves the session ready for the next message.
const afterTurn = model.updateAgentSession(state, session.session.id, { status: 'idle' }, context);
assert.equal(model.findAgentSession(afterTurn, session.session.id).status, 'idle');

// Closing an agent tab keeps the session record: history must outlive the tab.
const withClosedAgentTab = model.closeTab(state, agentTab.tab.id, context);
assert.equal(model.findAgentSession(withClosedAgentTab, session.session.id).status, 'running');

// --- serialize / restore ------------------------------------------------------
const restored = model.deserializeWorkbenchState(model.serializeWorkbenchState(state));
assert.deepEqual(restored.projects, state.projects);
assert.equal(restored.workspaces.length, state.workspaces.length);
assert.equal(restored.activeWorkspaceId, state.activeWorkspaceId);
assert.equal(
  model.findAgentSession(restored, session.session.id).status,
  'failed',
  '重启后运行中的会话不能假装仍在运行',
);
assert.deepEqual(model.deserializeWorkbenchState('{oops'), model.createWorkbenchState());
assert.deepEqual(model.deserializeWorkbenchState(null), model.createWorkbenchState());

// RES-2: a pre-resource file tab keyed `file:<raw path>` is rewritten onto the
// resource key on restore, so two spellings of one path cannot come back twice.
assert.equal(model.findTab(restored, openThird.tab.id).tab.key, 'resource:file:///1');

// Orphans and broken references are dropped instead of crashing the shell.
const repaired = model.normalizeWorkbenchState({
  version: 1,
  projects: [{ id: 'p1', rootPath: 'D:/one', createdAt: 'now' }, { id: 'p2' }],
  workspaces: [
    { id: 'w1', projectId: 'p1', createdAt: 'now', activeTabId: 'gone', tabs: [
      { id: 't1', kind: 'pdf', key: 'pdf:1', order: 7 },
      { id: 't2', kind: 'agent', key: 'agent:x', sessionId: 'missing' },
      { nope: true },
    ] },
    { id: 'w2', projectId: 'ghost' },
  ],
  agentSessions: [{ id: 's1', workspaceId: 'w9', providerId: 'codex' }],
  activeProjectId: 'ghost',
  activeWorkspaceId: 'w2',
});
assert.deepEqual(repaired.projects.map((project) => project.id), ['p1']);
assert.deepEqual(repaired.workspaces.map((workspace) => workspace.id), ['w1']);
assert.deepEqual(repaired.workspaces[0].tabs.map((tab) => [tab.id, tab.order]), [['t1', 0]]);
assert.equal(repaired.workspaces[0].activeTabId, 't1');
assert.deepEqual(repaired.agentSessions, []);
assert.equal(repaired.activeProjectId, 'p1');
assert.equal(repaired.activeWorkspaceId, 'w1');

// --- cascading removal --------------------------------------------------------
const removedSession = model.removeAgentSession(state, session.session.id, context);
assert.equal(model.findAgentSession(removedSession, session.session.id), null);
assert.equal(model.findTab(removedSession, agentTab.tab.id), null, '会话删除后其标签一并关闭');

let cascade = model.removeWorkspace(state, extra.workspace.id);
assert.equal(model.findWorkspace(cascade, extra.workspace.id), null);
assert.equal(cascade.activeWorkspaceId, mainWorkspaceId);

cascade = model.removeProject(state, created.project.id);
assert.equal(model.findProject(cascade, created.project.id), null);
assert.equal(model.workspacesForProject(cascade, created.project.id).length, 0);
assert.deepEqual(cascade.agentSessions, [], '删除项目应级联移除其会话');
assert.equal(cascade.activeProjectId, second.project.id);
assert.equal(cascade.activeWorkspaceId, model.workspacesForProject(cascade, second.project.id)[0].id);

// --- storage adapter (PWS-1) --------------------------------------------------
const store = await import('../src/workbench/workspaceStore.ts');

const writes = [];
let seeded = model.serializeWorkbenchState(
  model.createProject(model.createWorkbenchState(), { rootPath: 'D:/one', name: '一号' }, context).state,
);
const fakeStorage = {
  read: () => seeded,
  write: (value) => writes.push(value),
};

const wired = store.createWorkbenchStore(fakeStorage);
assert.equal(wired.getState().projects.length, 1, '存储适配器提供的快照应作为初始状态');
assert.equal(wired.getState().projects[0].name, '一号');
assert.equal(writes.length, 0, '仅读取不应触发写入');

let notified = 0;
const unsubscribe = wired.subscribe(() => { notified += 1; });
const projectId = wired.getState().projects[0].id;
wired.renameProject(projectId, '二号');
assert.equal(writes.length, 1, '每次状态变更写一次快照');
assert.equal(notified, 1);
assert.equal(model.deserializeWorkbenchState(writes[0]).projects[0].name, '二号');
wired.renameProject(projectId, '   ');
assert.equal(writes.length, 1, '状态未变化时不应重复写入');
assert.equal(notified, 1);
unsubscribe();
wired.renameProject(projectId, '三号');
assert.equal(notified, 1, '取消订阅后不再收到通知');
assert.equal(writes.length, 2);

seeded = null;
const emptySeed = store.createWorkbenchStore(fakeStorage);
assert.deepEqual(emptySeed.getState().projects, [], '没有快照时从空工作台开始');
assert.equal(emptySeed.getState().version, model.WORKBENCH_STATE_VERSION);
assert.equal(store.WORKBENCH_STORAGE_KEY, 'aster.workbench');

console.log('verify-workspace-model: ok');

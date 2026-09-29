import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// Left-edge scene switcher (80263463): timing state machine, safe path, placement,
// motion contract and wiring. The model is pure, so it is loaded directly.
const require = createRequire(import.meta.url);
const ts = require('typescript');
const load = (file) => {
  const source = fs.readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const mod = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${outputText}\n})`, { filename: file })(require, mod, mod.exports);
  return mod.exports;
};
const read = (file) => fs.readFileSync(file, 'utf8');
const model = load('src/workbench/sceneEdgeSwitcherModel.ts');
const { groupSidebarScenes } = load('src/workbench/sceneGroups.ts');
const {
  SCENE_EDGE_HOT_ZONE_PX, SCENE_EDGE_OPEN_DELAY_MS, SCENE_EDGE_CLOSE_GRACE_MS, SCENE_EDGE_SAFE_PATH_GRACE_MS,
  initialSceneEdgeState, reduceSceneEdge, isSceneEdgeOpen, isOnSafePath, pointInTriangle,
  placeSceneEdgePanel, normalizeSceneEdgeSwitcherEnabled, sceneEdgeMotion, sceneEdgeEnterTotalMs,
} = model;

// Parameters stay inside the ranges the task fixes.
assert.ok(SCENE_EDGE_HOT_ZONE_PX >= 6 && SCENE_EDGE_HOT_ZONE_PX <= 10, 'hot zone is 6-10px');
assert.ok(SCENE_EDGE_OPEN_DELAY_MS >= 120 && SCENE_EDGE_OPEN_DELAY_MS <= 180, 'open dwell is 120-180ms');
assert.ok(SCENE_EDGE_CLOSE_GRACE_MS >= 200 && SCENE_EDGE_CLOSE_GRACE_MS <= 300, 'close grace is 200-300ms');
assert.ok(SCENE_EDGE_SAFE_PATH_GRACE_MS > SCENE_EDGE_CLOSE_GRACE_MS, 'the safe path extends the grace');

/** Runs events in order and returns the final state plus every effect. */
const run = (events, state = initialSceneEdgeState(true)) => {
  const effects = [];
  for (const event of events) {
    const next = reduceSceneEdge(state, event);
    state = next.state;
    effects.push(...next.effects);
  }
  return { state, effects };
};
const edge = (x = 3, y = 300, extra = {}) => ({ type: 'pointer', zone: 'edge', point: { x, y }, ...extra });
const outside = (x, y, panel = null, extra = {}) => ({ type: 'pointer', zone: 'outside', point: { x, y }, panel, ...extra });
const inPanel = (x = 60, y = 300) => ({ type: 'pointer', zone: 'panel', point: { x, y } });
const timer = (name) => ({ type: 'timer', timer: name });
const schedules = (effects, name) => effects.filter((e) => e.type === 'schedule' && e.timer === name).map((e) => e.ms);
const panel = { left: 12, top: 180, right: 256, bottom: 460 };

// Entering the band only arms the open timer; the dwell opens it.
{
  const armed = run([edge()]);
  assert.equal(armed.state.phase, 'pending');
  assert.deepEqual(schedules(armed.effects, 'open'), [SCENE_EDGE_OPEN_DELAY_MS]);
  assert.equal(isSceneEdgeOpen(armed.state), false, 'nothing is shown before the dwell');
  const opened = run([timer('open')], armed.state);
  assert.equal(opened.state.phase, 'open');
  assert.equal(opened.state.source, 'hover');
  assert.equal(opened.state.anchorY, 300, 'a hover-opened panel centres on the pointer');
}
// A quick pass leaves the band before the dwell: cancelled, a late timer is ignored.
{
  const pass = run([edge(2, 200), outside(40, 205), timer('open')]);
  assert.equal(pass.state.phase, 'closed', 'quick pass does not open');
  assert.ok(pass.effects.some((e) => e.type === 'cancel' && e.timer === 'open'));
}
// Pressed buttons (drags, text selection, sidebar resize) and touch/pen hovers never arm.
for (const extra of [{ buttons: 1 }, { buttons: 2 }, { pointerType: 'touch' }, { pointerType: 'pen' }]) {
  assert.equal(run([edge(3, 300, extra)]).state.phase, 'closed', `edge hover with ${JSON.stringify(extra)} must not arm`);
}
assert.equal(run([edge(), edge(3, 310, { buttons: 1 })]).state.phase, 'closed', 'pressing during the dwell cancels it');
assert.equal(run([edge(), { type: 'pointerExitWindow' }, timer('open')]).state.phase, 'closed', 'leaving the window to the left (native resize border) cancels the dwell');

// Leaving an open panel starts the grace; the close timer closes it.
{
  const open = run([edge(), timer('open')]).state;
  const leaving = run([outside(420, 300, panel)], open);
  assert.equal(leaving.state.phase, 'leaving');
  assert.deepEqual(schedules(leaving.effects, 'close'), [SCENE_EDGE_CLOSE_GRACE_MS]);
  assert.ok(isSceneEdgeOpen(leaving.state), 'still visible during the grace');
  assert.equal(run([timer('close')], leaving.state).state.phase, 'closed');
  const back = run([inPanel()], leaving.state);
  assert.equal(back.state.phase, 'open', 'returning within the grace keeps it open');
  assert.ok(back.effects.some((e) => e.type === 'cancel' && e.timer === 'close'));
  assert.equal(run([edge(4, 320)], leaving.state).state.phase, 'open', 'returning to the band keeps it open');
}
// Safe triangle: moving diagonally from the band towards the panel gets the longer grace.
{
  const open = run([edge(4, 300), timer('open')]).state;
  assert.equal(isOnSafePath({ x: 9, y: 250 }, { x: 4, y: 300 }, panel), true);
  assert.equal(isOnSafePath({ x: 9, y: 120 }, { x: 4, y: 300 }, panel), false, 'above the panel is not on the way');
  assert.equal(isOnSafePath({ x: 300, y: 300 }, { x: 4, y: 300 }, panel), false, 'past the panel is not on the way');
  assert.equal(isOnSafePath({ x: 9, y: 250 }, { x: 60, y: 300 }, panel), false, 'an apex inside the panel has no path');
  const diagonal = run([outside(9, 250, panel)], open);
  assert.equal(diagonal.state.safePath, true);
  assert.deepEqual(schedules(diagonal.effects, 'close'), [SCENE_EDGE_SAFE_PATH_GRACE_MS]);
  const strayed = run([outside(9, 90, panel)], diagonal.state);
  assert.equal(strayed.state.safePath, false, 'leaving the triangle drops back to the normal grace');
  assert.deepEqual(schedules(strayed.effects, 'close'), [SCENE_EDGE_CLOSE_GRACE_MS]);
  assert.equal(run([inPanel(40, 250)], diagonal.state).state.phase, 'open', 'arriving on the panel keeps it open');
  assert.equal(pointInTriangle({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }), true);
  assert.equal(pointInTriangle({ x: 4, y: 4 }, { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }), false);
}
// Outside clicks close (the event is not cancelled); clicks inside do not.
{
  const open = run([edge(), timer('open')]).state;
  assert.equal(run([{ type: 'pointerDown', inside: false }], open).state.phase, 'closed');
  assert.equal(run([{ type: 'pointerDown', inside: true }], open).state.phase, 'open');
  assert.equal(run([{ type: 'select' }], open).state.phase, 'closed', 'choosing a scene closes the panel');
  assert.equal(run([{ type: 'suppress' }], open).state.phase, 'closed', 'drag/blur/resize suppression closes it');
}
// Keyboard: Enter/Space opens and focuses the panel; again or Esc closes and returns focus.
{
  const opened = run([{ type: 'activate', input: 'keyboard' }]);
  assert.equal(opened.state.phase, 'open');
  assert.equal(opened.state.source, 'keyboard');
  assert.ok(opened.effects.some((e) => e.type === 'focusPanel'));
  assert.equal(run([outside(600, 300, panel), timer('close')], opened.state).state.phase, 'open', 'keyboard openings ignore pointer travel');
  const escaped = run([{ type: 'escape' }], opened.state);
  assert.equal(escaped.state.phase, 'closed');
  assert.ok(escaped.effects.some((e) => e.type === 'focusHandle'), 'Esc returns focus to the handle');
  const toggled = run([{ type: 'activate', input: 'keyboard' }], opened.state);
  assert.equal(toggled.state.phase, 'closed');
  assert.ok(toggled.effects.some((e) => e.type === 'focusHandle'));
  assert.equal(run([{ type: 'escape' }]).effects.length, 0, 'Esc with nothing open is not claimed');
}
// Touch/pen: tapping the handle toggles; the click after a hover-open pins instead of closing.
{
  const tapped = run([{ type: 'activate', input: 'touch' }]);
  assert.equal(tapped.state.phase, 'open');
  assert.equal(tapped.state.source, 'press');
  assert.equal(run([{ type: 'activate', input: 'pen' }], tapped.state).state.phase, 'closed');
  const pinned = run([edge(), timer('open'), { type: 'activate', input: 'mouse' }]);
  assert.equal(pinned.state.phase, 'open');
  assert.equal(pinned.state.source, 'press');
  assert.equal(run([outside(600, 300, panel), timer('close')], pinned.state).state.phase, 'open', 'a pinned panel waits for an explicit dismissal');
}
// Setting: off closes and ignores everything; on starts fresh.
{
  const open = run([edge(), timer('open')]).state;
  const off = run([{ type: 'setEnabled', enabled: false }], open);
  assert.equal(off.state.phase, 'closed');
  assert.equal(off.state.enabled, false);
  assert.equal(run([edge(), timer('open'), { type: 'activate', input: 'keyboard' }], off.state).state.phase, 'closed', 'disabled switcher never opens');
  const on = run([{ type: 'setEnabled', enabled: true }], off.state);
  assert.deepEqual(on.state, initialSceneEdgeState(true));
  assert.equal(normalizeSceneEdgeSwitcherEnabled(undefined), true, 'default on');
  assert.equal(normalizeSceneEdgeSwitcherEnabled(false), false);
  assert.equal(normalizeSceneEdgeSwitcherEnabled('false'), true, 'only an explicit false turns it off');
}
// Placement: centred on the anchor, clamped into the shell, scrolls when taller.
{
  assert.deepEqual(placeSceneEdgePanel({ anchorY: 400, panelHeight: 200, boundsTop: 40, boundsBottom: 900 }), { top: 300, maxHeight: 844 });
  assert.equal(placeSceneEdgePanel({ anchorY: 50, panelHeight: 200, boundsTop: 40, boundsBottom: 900 }).top, 48, 'clamped below the title bar');
  assert.equal(placeSceneEdgePanel({ anchorY: 890, panelHeight: 200, boundsTop: 40, boundsBottom: 900 }).top, 692, 'clamped above the bottom');
  assert.deepEqual(placeSceneEdgePanel({ anchorY: 300, panelHeight: 900, boundsTop: 40, boundsBottom: 540 }), { top: 48, maxHeight: 484 }, 'taller panel pins to the top and scrolls');
}
// Motion contract.
{
  const normal = sceneEdgeMotion(false);
  const reduced = sceneEdgeMotion(true);
  assert.ok(normal.enterMs >= 180 && normal.enterMs <= 220, 'enter 180-220ms');
  assert.ok(normal.exitMs >= 120 && normal.exitMs <= 160, 'exit 120-160ms');
  assert.equal(normal.translate, true);
  assert.equal(reduced.translate, false, 'reduced motion fades without travel');
  assert.deepEqual([...normal.properties], ['transform', 'opacity']);
  assert.ok(normal.staggerMs <= 30, 'cascade step at most 30ms');
  assert.ok(sceneEdgeEnterTotalMs(12, normal) <= 260, 'whole enter sequence at most 260ms');
}
// One grouping source for the sidebar picker and the edge switcher.
{
  const groups = groupSidebarScenes([
    { id: 'plugin.x', scope: 'plugin' }, { id: 'markdown', scope: 'workspace' }, { id: 'overview', scope: 'research' }, { id: 'library', scope: 'research' },
  ]);
  assert.deepEqual(groups.map((g) => [g.id, g.label, g.items.map((s) => s.id)]), [
    ['research', '科研阅读', ['overview', 'library']], ['workspace', '工作区', ['markdown']], ['custom', '插件场景', ['plugin.x']],
  ]);
  assert.deepEqual(groupSidebarScenes([{ id: 'overview', scope: 'research' }]).map((g) => g.id), ['research'], 'empty groups are dropped');
}

// CSS: only transform/opacity are ever transitioned; will-change only while armed; reduced-motion branch.
{
  const css = read('src/workbench/scene-edge-switcher.css');
  const transitions = [...css.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1]);
  assert.ok(transitions.length >= 3);
  for (const value of transitions) {
    const properties = value.split(',').map((part) => part.trim().split(/\s+/)[0]);
    assert.ok(properties.every((p) => p === 'transform' || p === 'opacity'), `only transform/opacity may animate: ${value}`);
  }
  assert.doesNotMatch(css, /@keyframes/);
  assert.doesNotMatch(css, /transition:\s*all/);
  assert.match(css, /\.scene-edge\[data-layer="on"\] \.scene-edge-panel \{ will-change: transform, opacity; \}/);
  assert.equal((css.match(/will-change\s*:/g) ?? []).length, 1, 'no permanent compositor layer');
  assert.match(css, /\.scene-edge-panel\[data-open\] \{[^}]*transition: transform 200ms var\(--motion-panel-ease-out\), opacity 200ms var\(--motion-panel-ease-out\);/);
  assert.match(css, /transition: transform 140ms var\(--motion-panel-ease-in\), opacity 140ms var\(--motion-panel-ease-in\);/);
  const reducedBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reducedBlock, /\.scene-edge-panel\[data-open\] \{ transform: none; \}|\.scene-edge-panel,\s*\r?\n\s*\.scene-edge-panel\[data-open\] \{ transform: none; \}/);
  assert.match(reducedBlock, /\.scene-edge-panel \{ transition: opacity 120ms linear; \}/);
}
// Component: no layout-property animation, pointer handling never cancels outside clicks.
{
  const component = read('src/workbench/SceneEdgeSwitcher.tsx');
  assert.doesNotMatch(component, /style\.(left|width|right|marginLeft)\s*=/, 'no script-driven layout animation');
  assert.doesNotMatch(component, /requestAnimationFrame/);
  assert.match(component, /window\.addEventListener\('pointerdown', onPointerDown, \{ capture: true \}\)/);
  assert.doesNotMatch(component.slice(component.indexOf('const onPointerDown'), component.indexOf('const suppress')), /preventDefault|stopPropagation/, 'outside clicks reach their target');
  assert.match(component, /hit\.closest\(SCENE_EDGE_YIELD_SELECTOR\)/, 'the band yields to reader edge handles, resizers and dialogs');
  assert.match(component, /is-horizontal-resizing/);
  assert.match(component, /readRootZoom\(\)/, 'hot zone and panel rect follow the root zoom');
  assert.match(component, /shortcuts\.bindings\(`scene\.\$\{sceneId\}`\)/, 'reuses the scene.<id> shortcut commands');
  assert.match(model.SCENE_EDGE_YIELD_SELECTOR, /\.reader-note-edge-handle/);
  assert.match(model.SCENE_EDGE_YIELD_SELECTOR, /\.workbench-sidebar-resizer/);
}
// Wiring: same visible scene list and setScene as the sidebar; setting persisted in the UI state.
{
  const app = read('src/ui/App.tsx');
  assert.match(app, /edgeSwitcher=\{sceneEdgeSwitcherEnabled \? \(\s*<SceneEdgeSwitcher scenes=\{sidebarScenes\} activeSceneId=\{activeScene\} onOpenScene=\{setScene\}/);
  assert.match(app, /<ProjectSidebar[\s\S]{0,1200}scenes=\{sidebarScenes\}/, 'the sidebar renders the same list');
  assert.match(app, /useState\(persistedUiState\.sceneEdgeSwitcher\)/);
  assert.match(app, /sceneEdgeSwitcher: sceneEdgeSwitcherEnabled,/);
  assert.match(app, /sceneEdgeSwitcher=\{\{ enabled: sceneEdgeSwitcherEnabled, onChange: setSceneEdgeSwitcherEnabled \}\}/);
  const ui = read('src/shared/hooks/usePersistedUiState.ts');
  assert.match(ui, /sceneEdgeSwitcher: boolean;/);
  assert.match(ui, /sceneEdgeSwitcher: true,/);
  assert.match(ui, /sceneEdgeSwitcher: parsed\.sceneEdgeSwitcher !== false,/);
  assert.match(read('src/features/settings/sections/AppearanceSection.tsx'), /id="setting-scene-edge-switcher"/);
  assert.match(read('src/features/settings/catalog.ts'), /id: 'setting-scene-edge-switcher'/);
  assert.match(read('src/workbench/ProjectSidebar.tsx'), /const sceneGroups = groupSidebarScenes\(scenes\);/);
  assert.match(read('src/workbench/WorkbenchShell.tsx'), /\{edgeSwitcher\}/);
}

console.log('PASS scene edge switcher: dwell/quick pass, press/touch guards, grace + safe triangle, outside click, keyboard, touch toggle, setting, placement, motion contract, CSS transform/opacity only, wiring');

// Unit regression for task 6f9e0947: sidebar visibility has one source of truth.
// Runs the real TypeScript module through node --experimental-strip-types.
//   node --experimental-strip-types scripts/verify-sidebar-visibility.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const {
  WORKBENCH_SIDEBAR_NARROW_MAX_WIDTH,
  WORKBENCH_SIDEBAR_NARROW_QUERY,
  resolveSidebarPresentation,
  toggleSidebarVisibility,
  applySidebarViewport,
  dismissSidebarOverlay,
  revealSidebar,
  sidebarToggleLabel,
} = await import('../src/workbench/sidebarVisibility.ts');

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log('ok -', name); };
const state = (userCollapsed, narrow, overlayOpen = false) => ({ userCollapsed, narrow, overlayOpen });

test('四种组合：用户收起 × 视口窄', () => {
  assert.deepEqual(resolveSidebarPresentation(state(false, false)), { mode: 'docked', visible: true, narrow: false });
  assert.deepEqual(resolveSidebarPresentation(state(true, false)), { mode: 'hidden', visible: false, narrow: false });
  assert.deepEqual(resolveSidebarPresentation(state(false, true)), { mode: 'hidden', visible: false, narrow: true });
  assert.deepEqual(resolveSidebarPresentation(state(true, true)), { mode: 'hidden', visible: false, narrow: true });
});

test('窄视口下覆盖层打开即可见（不论用户偏好）', () => {
  assert.deepEqual(resolveSidebarPresentation(state(false, true, true)), { mode: 'overlay', visible: true, narrow: true });
  assert.deepEqual(resolveSidebarPresentation(state(true, true, true)), { mode: 'overlay', visible: true, narrow: true });
  // A stale overlay flag on a wide viewport never produces an overlay.
  assert.equal(resolveSidebarPresentation(state(false, false, true)).mode, 'docked');
});

test('宽视口切换改写用户偏好，窄视口切换只开关覆盖层', () => {
  assert.deepEqual(toggleSidebarVisibility(state(false, false)), state(true, false));
  assert.deepEqual(toggleSidebarVisibility(state(true, false)), state(false, false));
  assert.deepEqual(toggleSidebarVisibility(state(false, true)), state(false, true, true));
  assert.deepEqual(toggleSidebarVisibility(state(false, true, true)), state(false, true, false));
  assert.deepEqual(toggleSidebarVisibility(state(true, true)), state(true, true, true));
});

test('“按钮说展开了”必然可见：任意状态下点击后 visible 取反', () => {
  for (const userCollapsed of [false, true]) for (const narrow of [false, true]) for (const overlayOpen of [false, true]) {
    const before = state(userCollapsed, narrow, narrow && overlayOpen);
    const after = toggleSidebarVisibility(before);
    assert.equal(resolveSidebarPresentation(after).visible, !resolveSidebarPresentation(before).visible, JSON.stringify(before));
  }
});

test('变窄/变宽不改写持久化偏好，并清除覆盖层', () => {
  for (const userCollapsed of [false, true]) {
    const narrowed = applySidebarViewport(state(userCollapsed, false), true);
    assert.equal(narrowed.userCollapsed, userCollapsed);
    const opened = toggleSidebarVisibility(narrowed);
    const widened = applySidebarViewport(opened, false);
    assert.deepEqual(widened, state(userCollapsed, false, false));
    assert.equal(resolveSidebarPresentation(widened).visible, !userCollapsed, '变宽后恢复用户之前的选择');
  }
  const same = state(false, true, true);
  assert.equal(applySidebarViewport(same, true), same, '未跨越断点时保持引用不变');
});

test('Esc/点击内容区收起覆盖层；reveal 不会把可见的侧栏关掉', () => {
  assert.deepEqual(dismissSidebarOverlay(state(false, true, true)), state(false, true, false));
  const hidden = state(false, true);
  assert.equal(dismissSidebarOverlay(hidden), hidden);
  assert.deepEqual(revealSidebar(state(false, true)), state(false, true, true));
  assert.deepEqual(revealSidebar(state(true, false)), state(false, false));
  const docked = state(false, false);
  assert.equal(revealSidebar(docked), docked);
  const overlay = state(true, true, true);
  assert.equal(revealSidebar(overlay), overlay);
});

test('按钮文案描述点击后的动作', () => {
  assert.equal(sidebarToggleLabel(true), '收起侧栏');
  assert.equal(sidebarToggleLabel(false), '展开侧栏');
});

test('断点常量唯一：样式表不再用媒体查询单独隐藏侧栏', () => {
  assert.equal(WORKBENCH_SIDEBAR_NARROW_QUERY, `(max-width: ${WORKBENCH_SIDEBAR_NARROW_MAX_WIDTH}px)`);
  const styleDir = path.resolve('src/ui/styles');
  const offenders = [];
  for (const file of readdirSync(styleDir).filter((name) => name.endsWith('.css'))) {
    const css = readFileSync(path.join(styleDir, file), 'utf8');
    const mediaBlocks = css.matchAll(/@media[^{]*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g);
    for (const [whole, body] of mediaBlocks) {
      if (/\.workbench-sidebar\s*\{[^}]*(visibility\s*:\s*hidden|display\s*:\s*none)/.test(body)
        || /\.workbench-shell\s*\{[^}]*grid-template-columns\s*:\s*0\b/.test(body)) {
        offenders.push(`${file}: ${whole.split('{')[0].trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], '侧栏可见性只能由 React 状态驱动');
  const shell = readFileSync('src/workbench/WorkbenchShell.tsx', 'utf8');
  assert.match(shell, /useNarrowViewport\(\)/, 'WorkbenchShell 监听共享断点');
  const hook = readFileSync('src/workbench/useNarrowViewport.ts', 'utf8');
  assert.match(hook, /WORKBENCH_SIDEBAR_NARROW_QUERY/, 'hook 使用共享常量');
});

console.log(`\nsidebar visibility: ${passed} checks passed`);

// Task 24ea34e5 - note workbench core: mode machine, per-paper preferences and
// geometry. Pure module coverage; the render-level suite drives the real DOM.
//   node scripts/verify-note-workbench.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  FLOATING_RECT_DEFAULT,
  NOTE_WORKBENCH_COMMANDS,
  NOTE_WORKBENCH_COMMAND_LIST,
  NOTE_WORKBENCH_NARROW_BREAKPOINT,
  NOTE_WORKBENCH_WIDE_BREAKPOINT,
  SPLIT_RATIO_DEFAULT,
  clampFloatingRect,
  clampSplitRatio,
  defaultNoteWorkbenchPrefs,
  floatingCardBox,
  loadNoteWorkbenchPrefs,
  modeForNoteWorkbenchCommand,
  normalizeNoteWorkbenchPrefs,
  noteWorkbenchStorageKey,
  resolveNoteWorkbenchMode,
  preferredNoteIdFor,
  rememberPreferredNoteId,
  saveNoteWorkbenchPrefs,
  splitWidthPx,
} from '../src/features/reader/noteWorkbench.ts';

const checks = [];
const ok = (condition, name) => { checks.push(name); assert.ok(condition, name); };

// ---------------------------------------------------------------- mode machine
ok(defaultNoteWorkbenchPrefs().mode === 'reading', '默认模式为 PDF 专注（笔记收起）');
ok(resolveNoteWorkbenchMode({ ...defaultNoteWorkbenchPrefs(), mode: 'split' }, 1440).mode === 'split', '宽容器保持 split');
const narrow = resolveNoteWorkbenchMode({ ...defaultNoteWorkbenchPrefs(), mode: 'split' }, 900);
ok(narrow.mode === 'floating' && narrow.temporary === true && narrow.requested === 'split', '窄容器临时降级为悬浮卡但保留宽屏偏好');
const stillWide = resolveNoteWorkbenchMode({ ...defaultNoteWorkbenchPrefs(), mode: 'split' }, 1300);
ok(stillWide.temporary === false, '放大回宽屏后恢复用户 split 偏好');
ok(resolveNoteWorkbenchMode({ ...defaultNoteWorkbenchPrefs(), mode: 'writing' }, 1000).mode === 'writing', '980-1199px 仍可专注写作');
ok(normalizeNoteWorkbenchPrefs({ activeNoteId: 42 }).activeNoteId === null, '活动笔记偏好损坏时回退 null');
ok(normalizeNoteWorkbenchPrefs({ previousMode: 'teleport' }).previousMode === 'reading', '返回模式损坏时回退默认');
ok(defaultNoteWorkbenchPrefs().previousMode === 'reading', '默认返回模式为 PDF 专注');
ok(NOTE_WORKBENCH_NARROW_BREAKPOINT === 980 && NOTE_WORKBENCH_WIDE_BREAKPOINT === 1200, '断点常量为 980/1200');

// ---------------------------------------------------------------- preferences
ok(clampSplitRatio(0.9) === 0.62 && clampSplitRatio(0.01) === 0.26, 'split 比例夹在 26%-62%');
ok(clampSplitRatio('nonsense') === SPLIT_RATIO_DEFAULT, '非法 split 比例回退默认值');
const normalized = normalizeNoteWorkbenchPrefs({ mode: 'hologram', wideMode: 'split', splitRatio: 'x', floating: { x: 5, y: -3 } });
ok(normalized.mode === 'reading', '非法模式安全回退');
ok(normalized.splitRatio === SPLIT_RATIO_DEFAULT, '损坏比例安全回退');
ok(normalized.floating.x <= 0.9 && normalized.floating.y >= 0, '悬浮卡坐标夹在容器内');
ok(normalizeNoteWorkbenchPrefs(null).mode === 'reading' && normalizeNoteWorkbenchPrefs('x').floating.width === FLOATING_RECT_DEFAULT.width, 'null/字符串偏好安全回退');
ok(clampFloatingRect({ width: 4, height: 0.01 }).width === 0.96 && clampFloatingRect({ height: 0.01 }).height === 0.22, '悬浮卡尺寸夹在 22%-96%');
ok(clampFloatingRect({ width: 4 }).height === FLOATING_RECT_DEFAULT.height, '缺失尺寸字段回退默认值');

// ---------------------------------------------------------------- geometry
ok(splitWidthPx(1440, SPLIT_RATIO_DEFAULT) === Math.round(1440 * SPLIT_RATIO_DEFAULT), '宽容器 split 宽度按比例');
ok(splitWidthPx(1000, 0.62) <= 1000 - 520, 'split 宽度保证 PDF 最小可读宽度');
ok(splitWidthPx(600, 0.62) >= 300, '窄容器 split 宽度不低于笔记最小宽度');
const box = floatingCardBox({ x: 0.9, y: 0.9, width: 0.6, height: 0.6 }, 1200, 800);
ok(box.left + box.width <= 1200 && box.top + box.height <= 800, '悬浮卡完全落在容器内');
ok(box.width >= 240 && box.height >= 200, '悬浮卡保持最小可操作尺寸');

// ---------------------------------------------------------------- commands
ok(modeForNoteWorkbenchCommand(NOTE_WORKBENCH_COMMANDS.split) === 'split', '命令 reader.notes.mode.split 映射 split');
ok(modeForNoteWorkbenchCommand(NOTE_WORKBENCH_COMMANDS.focus) === 'writing', '命令 reader.notes.mode.focus 映射专注写作');
ok(modeForNoteWorkbenchCommand(NOTE_WORKBENCH_COMMANDS.quickCapture) === 'floating', '命令 reader.notes.quickCapture 映射悬浮速记');
ok(modeForNoteWorkbenchCommand(NOTE_WORKBENCH_COMMANDS.pdfFocus) === 'reading', '命令 reader.pdf.focus 收起笔记');
ok(modeForNoteWorkbenchCommand('reader.notes.toggle') === null, 'toggle 命令不强制切换模式（恢复上次模式）');
ok(NOTE_WORKBENCH_COMMAND_LIST.map(item => item.id).includes('reader.notes.toggle'), '共享 registry 命令清单包含 toggle');

// ---------------------------------------------------------------- storage
const remembered = new Map();
const rememberedStorage = { getItem: key => (remembered.has(key) ? remembered.get(key) : null), setItem: (key, value) => remembered.set(key, value) };
rememberPreferredNoteId('paper-a', 'note-7', rememberedStorage);
ok(preferredNoteIdFor('paper-a', rememberedStorage) === 'note-7', '按论文记住活动笔记');
ok(preferredNoteIdFor('paper-z', rememberedStorage) === null, '未记录的论文没有活动笔记');

const map = new Map();
const storage = { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, value) };
saveNoteWorkbenchPrefs('paper-a', { mode: 'split', wideMode: 'writing', splitRatio: 0.5, floating: { x: 0.2, y: 0.3, width: 0.4, height: 0.5 } }, storage);
saveNoteWorkbenchPrefs('paper-b', { ...defaultNoteWorkbenchPrefs(), mode: 'floating' }, storage);
ok(/^a4note\.reader\.noteWorkbench\./.test(noteWorkbenchStorageKey('paper-a')), '偏好按论文分键存储');
ok(loadNoteWorkbenchPrefs('paper-a', storage).mode === 'split' && loadNoteWorkbenchPrefs('paper-a', storage).splitRatio === 0.5, '按论文恢复模式与 split 宽度');
ok(loadNoteWorkbenchPrefs('paper-b', storage).mode === 'floating', '第二篇论文偏好互不串用');
ok(loadNoteWorkbenchPrefs('paper-a', storage).mode !== loadNoteWorkbenchPrefs('paper-b', storage).mode, '切换论文不携带上一论文状态');
map.set(noteWorkbenchStorageKey('paper-c'), '{not json');
ok(loadNoteWorkbenchPrefs('paper-c', storage).mode === 'reading', '损坏偏好安全回退默认');
ok(loadNoteWorkbenchPrefs('paper-d', { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } }).mode === 'reading', '存储被拒时不影响阅读');

// ---------------------------------------------------------------- wiring guards
const scene = fs.readFileSync('src/features/reader/ReaderScene.tsx', 'utf8');
const drawer = fs.readFileSync('src/features/reader/ReaderSideDrawer.tsx', 'utf8');
const css = fs.readFileSync('src/features/reader/reader-writing-layout.css', 'utf8');
ok(scene.includes('ReaderNoteWorkbenchMenu'), '读场景接入唯一工作台入口');
ok(scene.includes("data-note-mode"), '读场景暴露 data-note-mode 供测试与样式使用');
ok(!scene.includes('reader-note-reopen'), '旧的纵向“继续笔记”耳朵已移除');
ok(!drawer.includes('reader-writing-expand'), '旧“全宽/分栏”按钮已从笔记流程移除');
ok(css.includes('note-mode-floating') && css.includes('note-mode-writing'), '样式覆盖悬浮与专注写作模式');
ok(css.includes('prefers-reduced-motion'), '减少动效偏好被样式处理');
ok(/--authoring-content-max-width/.test(css), '正文列使用共享内容宽度 token');
const tokens = fs.readFileSync('src/ui/styles/tokens.css', 'utf8');
ok(/--authoring-content-max-width:\s*720px/.test(tokens), '共享正文列宽度 token 定义在 tokens.css');
const dockCss = fs.readFileSync('src/features/explorer/markdown-dock-layout.css', 'utf8');
ok(!/min\(760px/.test(dockCss) && /--authoring-content-max-width/.test(dockCss), '独立 Markdown 不再自带第二套宽度常量');
const markdown = fs.readFileSync('src/features/reader/ReaderMarkdown.tsx', 'utf8');
ok(markdown.includes('rememberPreferredNoteId') && markdown.includes('preferredNoteIdFor'), '活动笔记按论文恢复');
const resizer = fs.readFileSync('src/features/reader/ReaderDrawerResizer.tsx', 'utf8');
ok(resizer.includes('ArrowLeft') && resizer.includes('Home'), '侧栏宽度提供键盘替代控制');
ok(scene.includes('setSplitRatio'), '拖动侧栏后按论文持久化比例');
ok(scene.includes('exitNoteMode()'), '专注写作可经 Escape 返回进入前的模式');
const hookSource = fs.readFileSync('src/features/reader/useNoteWorkbench.ts', 'utf8');
ok(hookSource.includes('restoreMode') && hookSource.includes('previousMode'), '退出宽屏模式回到进入前的模式且保留宽屏偏好');
const menuSource = fs.readFileSync('src/features/reader/ReaderNoteWorkbenchMenu.tsx', 'utf8');
const shortcutPropsSource = fs.readFileSync('src/shared/shortcuts/ShortcutProvider.tsx', 'utf8');
ok(menuSource.includes('shortcutProps(MODE_COMMAND[candidate]') && shortcutPropsSource.includes("'aria-keyshortcuts': aria"), '菜单项通过共享绑定的 aria-keyshortcuts 反映配置');

ok(!scene.includes('compactLabel="笔记工作台"') && !scene.includes('ReaderToolbarPortal'), '标题栏及响应式溢出不再注册笔记工作台');
ok(menuSource.includes('reader-note-edge-handle') && menuSource.includes('shortcutProps(NOTE_WORKBENCH_COMMANDS.toggle'), '上下文提示保持绑定到边缘按钮');
ok(drawer.includes('ReaderNoteModeSwitch'), '笔记面板头部提供紧凑布局切换');
const gesture = fs.readFileSync('src/features/reader/useReaderDrawerGesture.ts', 'utf8');
ok(gesture.includes('>= 4') && gesture.includes('400'), '轻点拖宽4px阈值和400ms长按共用指针事务');
ok(resizer.includes('useReaderDrawerGesture') && menuSource.includes('useReaderDrawerGesture'), '书签与原分隔条复用拖动实现');
ok(gesture.includes('pointercancel') && gesture.includes('lostpointercapture') && gesture.includes('releasePointerCapture'), '取消与释放路径清理指针捕获');

console.log(`note workbench checks passed: ${checks.length}/${checks.length}`);

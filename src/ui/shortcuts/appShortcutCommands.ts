import type { ShortcutBinding, ShortcutCommand } from '../../core/shortcuts';
import type { ReaderTool } from '../../core/types';
type ReaderFileMode = 'source' | 'translated' | 'parallel';
export type AppShortcutOptions = {
  scenes: { id: string; label: string; key?: string }[];
  hasPaper: boolean; pdfMode: boolean; hasSourcePdf: boolean; hasTranslatedPdf: boolean;
  focusedAnnotation: boolean; canUndo: boolean; canRedo: boolean;
  palette: () => void; openScene: (id: string) => void; importPdf: () => void; librarySearch: () => void;
  pdfSearch: () => void; undo: () => void; redo: () => void; deleteAnnotation: () => void; cancel: () => boolean;
  selectTool: (tool: ReaderTool) => void; selectReaderFileMode: (mode: ReaderFileMode) => void;
  pdfZoom: (delta: number) => void; fitWidth: () => void; uiZoom: (delta: number | null) => void;
};
const key = (key: string, extra: Partial<Extract<ShortcutBinding, { type: 'keyboard' }>> = {}): ShortcutBinding => ({ type: 'keyboard', key, ctrl: true, ...extra });
const wheel = (direction: 'up' | 'down') => ({
  keys: ['Ctrl', direction === 'up' ? '滚轮↑' : '滚轮↓'],
  compactKeys: [direction === 'up' ? '滚轮↑' : '滚轮↓'],
  description: `Ctrl+鼠标滚轮向${direction === 'up' ? '上' : '下'}`,
});
export function createAppShortcutCommands(a: AppShortcutOptions): ShortcutCommand[] {
  const global = { kind: 'global' } as const, workbench = { kind: 'workbench' } as const, reader = { kind: 'scene', sceneId: 'reader' } as const;
  const pdf = () => a.hasPaper && a.pdfMode;
  return [
    { id: 'global.palette', title: '命令面板', group: '工作台', scope: workbench, defaultBindings: [key('k'), key('p', { shift: true })], allowInEditable: true, execute: a.palette },
    ...a.scenes.map((s): ShortcutCommand => ({ id: `scene.${s.id}`, title: `打开${s.label}`, group: '场景切换', scope: workbench, defaultBindings: s.key ? [key(s.key)] : [], showInHints: (context) => context.activeSceneId !== s.id, execute: () => a.openScene(s.id) })),
    { id: 'library.importPdf', title: '导入 PDF', group: '工作台', scope: workbench, defaultBindings: [key('o')], execute: a.importPdf },
    { id: 'library.search', title: '搜索文献库', group: '工作台', scope: workbench, defaultBindings: [key('f')], inactiveSceneIds: ['reader'], execute: a.librarySearch },
    { id: 'library.openReader', title: '阅读选中文献', group: '工作台', scope: workbench, defaultBindings: [key('Enter')], showInHints: (context) => context.activeSceneId !== 'reader', isEnabled: () => a.hasPaper, execute: () => a.openScene('reader') },
    { id: 'global.zoomIn', title: '放大界面', group: '全局界面缩放', scope: global, defaultBindings: [], fixedGesture: wheel('up'), isVisible: (context) => context.activeSceneId !== 'reader' || !pdf() },
    { id: 'global.zoomOut', title: '缩小界面', group: '全局界面缩放', scope: global, defaultBindings: [], fixedGesture: wheel('down'), isVisible: (context) => context.activeSceneId !== 'reader' || !pdf() },
    { id: 'reader.file.source', title: '原文视图', group: '阅读视图', scope: reader, defaultBindings: [key('F1')], isVisible: pdf, isEnabled: () => pdf() && a.hasSourcePdf, execute: () => a.selectReaderFileMode('source') },
    { id: 'reader.file.translated', title: '译文视图', group: '阅读视图', scope: reader, defaultBindings: [key('F2')], isVisible: pdf, isEnabled: () => pdf() && a.hasTranslatedPdf, execute: () => a.selectReaderFileMode('translated') },
    { id: 'reader.file.parallel', title: '对照视图', group: '阅读视图', scope: reader, defaultBindings: [key('F3')], isVisible: pdf, isEnabled: () => pdf() && a.hasSourcePdf && a.hasTranslatedPdf, execute: () => a.selectReaderFileMode('parallel') },
    { id: 'reader.search', title: '搜索当前 PDF', group: '阅读', scope: reader, defaultBindings: [key('f')], isEnabled: pdf, execute: a.pdfSearch },
    { id: 'reader.zoomIn', title: '放大 PDF', group: '阅读', scope: reader, defaultBindings: [], fixedGesture: wheel('up'), isVisible: pdf },
    { id: 'reader.zoomOut', title: '缩小 PDF', group: '阅读', scope: reader, defaultBindings: [], fixedGesture: wheel('down'), isVisible: pdf },
    { id: 'reader.fitWidth', title: 'PDF 适合宽度', group: '阅读', scope: reader, defaultBindings: [key('0')], isEnabled: pdf, execute: a.fitWidth },
    { id: 'reader.undo', title: '撤销标注', group: '标注操作', scope: reader, defaultBindings: [key('z')], isEnabled: () => pdf() && a.canUndo, execute: a.undo },
    { id: 'reader.redo', title: '重做标注', group: '标注操作', scope: reader, defaultBindings: [key('y'), key('z', { shift: true })], isEnabled: () => pdf() && a.canRedo, execute: a.redo },
    { id: 'reader.delete', title: '删除选中标注', group: '标注操作', scope: reader, defaultBindings: [key('Delete', { ctrl: false }), key('Backspace', { ctrl: false })], isEnabled: () => pdf() && a.focusedAnnotation, execute: a.deleteAnnotation },
    { id: 'reader.cancel', title: '取消标注选择', group: '标注操作', scope: reader, defaultBindings: [key('Escape', { ctrl: false })], isEnabled: () => pdf() && a.focusedAnnotation, execute: a.cancel },
    ...([['cursor', 'm', '光标'], ['highlight', 'h', '高亮'], ['underline', 'u', '下划线'], ['area', 'b', '区域选择'], ['text', 't', '文本框'], ['ink', 'p', '画笔'], ['eraser', 'e', '橡皮擦'], ['rect', 'r', '图形'], ['arrow', 'a', '箭头']] as const).map(([tool, binding, title]): ShortcutCommand => ({ id: `reader.tool.${tool}`, title, group: '标注工具', scope: reader, defaultBindings: [key(binding)], isEnabled: pdf, execute: () => a.selectTool(tool) })),
  ];
}

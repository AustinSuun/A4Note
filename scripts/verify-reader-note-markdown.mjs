// Reader sidebar notes reuse the standalone Markdown editor, dock and citation label.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { annotationCitationInsert, annotationCitationLabel, annotationReferenceToken } from '../src/features/reader/annotationCitation.ts';

const checks = [];
const ok = (condition, name) => { checks.push(name); assert.ok(condition, name); };

ok(annotationCitationLabel('文本框', '第 3 页') === '文本框 · 第 3 页', '引用标签为类型 · 页码');
ok(annotationReferenceToken('ann-1') === '@annotation(ann-1)', '引用记号保持 @annotation 协议');
ok(annotationReferenceToken('bad id') === '' && annotationReferenceToken('a(b)') === '', '含空白或括号的标注 ID 不生成记号');
ok(annotationCitationInsert('ann-1') === '\n\n@annotation(ann-1)\n', '插入内容是独立段落');
ok(annotationCitationInsert(' ') === '', '空 ID 不插入');

const panel = fs.readFileSync('src/features/reader/ReaderMarkdown.tsx', 'utf8');
const editor = fs.readFileSync('src/features/reader/MarkdownLiveEditor.tsx', 'utf8');
const side = fs.readFileSync('src/features/reader/ReaderSidePanelContent.tsx', 'utf8');
const read = fs.readFileSync('src/features/reader/MarkdownReadContent.tsx', 'utf8');
ok(panel.includes('MarkdownAuthoringDock'), '阅读笔记挂载主笔记格式工具栏');
ok(panel.includes('sourceMode={sourceMode}'), '工具栏实时/源码切换接到同一编辑器');
ok(panel.includes('note-citation-insert'), '阅读笔记可插入当前标注引用');
ok(panel.includes("mode === 'edit' && editorRef.current"), '已在编辑模式时引用立即写入');
ok(panel.includes('className="md-body markdown-preview note-preview-only"'), '阅读预览仍走共享 Markdown 渲染');
ok(editor.includes('MarkdownLivePreviewEditor') && editor.includes('insertTemplate'), '阅读笔记编辑器转发主笔记插入能力');
ok(side.includes('focusedAnnotationId={focusedAnnotationId}'), '侧栏把当前标注传给笔记面板');
ok(read.includes('annotationCitationLabel('), '渲染引用与工具栏使用同一标签格式');

console.log('reader note markdown: ' + checks.length + ' checks passed');

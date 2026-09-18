import { useEffect, useRef, useState } from 'react';
import { markdownTemplates, type MarkdownTemplate } from './markdownTemplates';
import './markdown-authoring.css';
import './markdown-dock-layout.css';
import { dockIconPaths } from '../../shared/dockIconPaths';
import { DockInsertOptions, type DockOptionKind } from './DockInsertOptions';
import { Code2, Eye, Shapes, Bold, Italic, Underline, Strikethrough, Highlighter, Link, Heading2, List, ListOrdered, Quote, SquareCheck, Table2, Image, Braces, Sigma, Minus, Footprints, MessageSquare, type LucideIcon } from 'lucide-react';

type Props = {
  open: boolean; onOpenChange: (open: boolean) => void;
  onInsert: (template: MarkdownTemplate) => void;
  onFormat: (before: string, after: string, placeholder: string) => void;
  onImage: () => void; sourceMode: boolean; onToggleSource: () => void;
};
export function MarkdownAuthoringDock({ open, onOpenChange, onInsert, onFormat, onImage, sourceMode, onToggleSource }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<DockOptionKind | null>(null);
  const optionTrigger = useRef<HTMLButtonElement | null>(null);
  const closeOptions = () => { setOptions(null); optionTrigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!options) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOptions(null); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [options]);
  useEffect(() => {
    if (!open) return;
    setQuery('');
    search.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onOpenChange(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onOpenChange(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open, onOpenChange]);
  const insert = (template: MarkdownTemplate) => { onInsert(template); onOpenChange(false); setOptions(null); };
  const showOptions = (kind: DockOptionKind, button: HTMLButtonElement) => { optionTrigger.current = button; onOpenChange(false); setOptions(current => current === kind ? null : kind); };
  const items = markdownTemplates.filter((item) => (item.label + item.group + item.source).toLowerCase().includes(query.toLowerCase()));
  const label = (text: string, Icon: LucideIcon) => {
    const path = text === '下划线' ? dockIconPaths.underline : text === '高亮' ? dockIconPaths.highlight : text === '提示块' ? dockIconPaths.comment : null;
    return <>{path
      ? <svg className="markdown-dock-icon" width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
      : <Icon className="markdown-dock-icon" size={24} strokeWidth={2.2} aria-hidden="true" />}<span className="markdown-dock-label">{text}</span></>;
  };
  const formatActions = [
    { text: '粗体', Icon: Bold, before: '**', after: '**', placeholder: '文字' },
    { text: '斜体', Icon: Italic, before: '*', after: '*', placeholder: '文字' },
    { text: '下划线', Icon: Underline, before: '<u>', after: '</u>', placeholder: '文字' },
    { text: '删除线', Icon: Strikethrough, before: '~~', after: '~~', placeholder: '文字' },
    { text: '高亮', Icon: Highlighter, before: '==', after: '==', placeholder: '文字' },
    { text: '行内代码', Icon: Code2, before: '`', after: '`', placeholder: '代码' },
    { text: '链接', Icon: Link, before: '[', after: '](https://example.com)', placeholder: '链接文字' },
  ];
  const blockActions = [
    { id: 'h2', text: '标题', Icon: Heading2 }, { id: 'bullet', text: '列表', Icon: List },
    { id: 'numbered', text: '编号', Icon: ListOrdered }, { id: 'quote', text: '引用', Icon: Quote },
    { id: 'tasks', text: '任务', Icon: SquareCheck }, { id: 'table', text: '表格', Icon: Table2 },
    { id: 'code', text: '代码块', Icon: Braces }, { id: 'math', text: '公式', Icon: Sigma },
    { id: 'rule', text: '分隔线', Icon: Minus }, { id: 'footnote', text: '脚注', Icon: Footprints },
    { id: 'callout-NOTE', text: '提示块', Icon: MessageSquare },
  ];
  // Row-major DOM order is also keyboard order. Pair similar label lengths vertically.
  const actionOrder = ['mode', 'styles', '粗体', '斜体', '下划线', '删除线', '行内代码', '高亮', 'bullet', 'numbered', 'tasks',
    'h2', '链接', 'quote', 'footnote', 'rule', 'callout-NOTE', 'code', 'math', 'table', 'image'];
  const orderedActions = [
      <button key="mode" type="button" aria-pressed={sourceMode} aria-label={sourceMode ? '源码，切换到实时预览' : '实时，切换到源码编辑'} title={sourceMode ? '切换到实时预览' : '切换到源码编辑'} onClick={onToggleSource}>{label(sourceMode ? '源码' : '实时', sourceMode ? Code2 : Eye)}</button>,
      <button key="styles" ref={trigger} type="button" className={open ? 'active' : ''} title="全部样式与模板" aria-label="全部样式与模板" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOptions(null); onOpenChange(!open); }}>{label('样式', Shapes)}</button>,
      ...formatActions.map(({ text, Icon, before, after, placeholder }) => <button key={text} type="button" title={text} aria-label={text} aria-haspopup={text === '链接' ? 'dialog' : undefined} aria-expanded={text === '链接' ? options === 'link' : undefined} onClick={event => text === '链接' ? showOptions('link', event.currentTarget) : onFormat(before, after, placeholder)}>{label(text, Icon)}</button>),
      ...blockActions.map(({ id, text, Icon }) => {
        const kind: DockOptionKind | null = id === 'h2' ? 'heading' : id === 'callout-NOTE' ? 'callout' : id === 'table' || id === 'code' || id === 'math' ? id : null;
        return <button key={id} type="button" title={text} aria-label={text} aria-haspopup={kind ? 'dialog' : undefined} aria-expanded={kind ? options === kind : undefined} onClick={event => kind ? showOptions(kind, event.currentTarget) : insert(markdownTemplates.find(item => item.id === id)!)}>{label(text, Icon)}</button>;
      }),
      <button key="image" type="button" title="插入本地图片" aria-label="插入本地图片" onClick={onImage}>{label('图片', Image)}</button>,
  ].sort((a, b) => actionOrder.indexOf(String(a.key)) - actionOrder.indexOf(String(b.key)));
  return <div ref={root} className="markdown-authoring-dock">
    {options && <DockInsertOptions key={options} kind={options} onInsert={insert} onFormat={onFormat} onClose={closeOptions} />}
    {open && <section className="markdown-template-panel" role="dialog" aria-label="插入 Markdown 模板">
      <div className="markdown-template-heading"><strong>全部样式 · {markdownTemplates.length}</strong><button type="button" onClick={() => { onOpenChange(false); trigger.current?.focus(); }} aria-label="关闭模板">×</button></div>
      <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、表格、公式…" aria-label="搜索模板" />
      <div className="markdown-template-list">
        {['文本与标题', '列表与内容块', '标注块'].map((group) => <div key={group}>{items.some((item) => item.group === group) && <h4>{group}</h4>}
          {items.filter((item) => item.group === group).map((item) => <button key={item.id} type="button" onClick={() => insert(item)} title={item.source}><span>{item.label}</span><code>{item.source.split('\n')[0]}</code></button>)}
        </div>)}
        {!items.length && <p>没有匹配的模板</p>}
      </div>
      <small>插入后可直接修改占位文字；图片可用下方“图片”选择本地文件。文档属性仍在顶部属性区管理。</small>
    </section>}
    <div className="markdown-authoring-actions" role="toolbar" aria-label="笔记编辑工具" onMouseDown={(event) => event.preventDefault()}>
      {orderedActions}
    </div>
  </div>;
}

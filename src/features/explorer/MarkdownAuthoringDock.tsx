import { useEffect, useRef, useState } from 'react';
import { markdownTemplates, type MarkdownTemplate } from './markdownTemplates';
import './markdown-authoring.css';

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
  const insert = (template: MarkdownTemplate) => { onInsert(template); onOpenChange(false); };
  const items = markdownTemplates.filter((item) => (item.label + item.group + item.source).toLowerCase().includes(query.toLowerCase()));
  return <div ref={root} className="markdown-authoring-dock">
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
      <button type="button" aria-pressed={sourceMode} title={sourceMode ? '切换到实时预览' : '切换到源码编辑'} onClick={onToggleSource}>{sourceMode ? '源码' : '实时'}</button>
      <span className="markdown-dock-divider" />
      <button ref={trigger} type="button" className={open ? 'active' : ''} aria-haspopup="dialog" aria-expanded={open} onClick={() => onOpenChange(!open)}>＋ 样式</button>
      <span className="markdown-dock-divider" />
      <button type="button" title="粗体" aria-label="粗体" onClick={() => onFormat('**', '**', '文字')}><b>B</b></button>
      <button type="button" title="斜体" aria-label="斜体" onClick={() => onFormat('*', '*', '文字')}><i>I</i></button>
      <button type="button" title="高亮" onClick={() => onFormat('==', '==', '文字')}>高亮</button>
      <button type="button" onClick={() => insert(markdownTemplates.find((item) => item.id === 'tasks')!)}>任务</button>
      <button type="button" onClick={() => insert(markdownTemplates.find((item) => item.id === 'table')!)}>表格</button>
      <button type="button" onClick={onImage}>图片</button>
    </div>
  </div>;
}

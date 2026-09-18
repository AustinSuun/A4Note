import { useLayoutEffect, useRef, useState } from 'react';
import { markdownTemplates, type MarkdownTemplate } from './markdownTemplates';
import { DockTablePicker } from './DockTablePicker';
import { DockCodeLanguagePicker } from './DockCodeLanguagePicker';
import './dock-insert-pickers.css';
export type DockOptionKind = 'heading' | 'table' | 'code' | 'math' | 'link' | 'callout';
const titles: Record<DockOptionKind, string> = { heading: '标题级别', table: '插入表格', code: '插入代码块', math: '数学公式', link: '插入链接', callout: '提示块类型' };
export function DockInsertOptions({ kind, onInsert, onFormat, onClose }: {
  kind: DockOptionKind; onInsert: (template: MarkdownTemplate) => void;
  onFormat: (before: string, after: string, placeholder: string) => void; onClose: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const [language, setLanguage] = useState('text'), [url, setUrl] = useState('https://');
  const [error, setError] = useState('');
  useLayoutEffect(() => { (root.current?.querySelector<HTMLElement>('[data-insert-autofocus], [role="gridcell"][tabindex="0"]') ?? root.current?.querySelector<HTMLElement>('input,select,button'))?.focus({ preventScroll: true }); }, []);
  const snippet = (source: string) => onInsert({ id: 'custom', label: titles[kind], group: '列表与内容块', block: true, source });
  const pick = (id: string) => { const item = markdownTemplates.find(item => item.id === id); if (item) onInsert(item); };
  return <section ref={root} className="markdown-template-panel markdown-insert-options" role="dialog" aria-label={titles[kind]}
    onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="markdown-template-heading"><strong>{titles[kind]}</strong><button type="button" onClick={onClose} aria-label="关闭设置">×</button></div>
    {kind === 'heading' && <div className="markdown-insert-choice-grid">{Array.from({ length: 6 }, (_, i) => <button key={i} type="button" onClick={() => pick(`h${i + 1}`)}>H{i + 1} · {i + 1}级标题</button>)}</div>}
    {kind === 'table' && <DockTablePicker onInsert={snippet} />}
    {kind === 'code' && <form onSubmit={event => { event.preventDefault(); snippet('```' + language + '\n在这里输入代码\n```'); }}><DockCodeLanguagePicker value={language} onChange={setLanguage} /><button className="markdown-insert-confirm" type="submit">插入代码块</button></form>}
    {kind === 'math' && <div className="markdown-insert-choice-grid"><button type="button" onClick={() => { onFormat('$', '$', 'E = mc^2'); onClose(); }}>行内公式</button><button type="button" onClick={() => pick('math')}>块级公式</button></div>}
    {kind === 'link' && <form onSubmit={event => { event.preventDefault(); const value = url.trim(); if (!/^(https?:\/\/|mailto:)/i.test(value) || /[\s<>]/.test(value) || value === 'https://') { setError('请输入完整的 http、https 或邮件地址'); return; } onFormat('[', '](' + value.replace(/\(/g, '%28').replace(/\)/g, '%29') + ')', '链接文字'); onClose(); }}><label>链接地址<input value={url} onChange={event => { setUrl(event.target.value); setError(''); }} placeholder="https://example.com" /></label>{error && <small role="alert">{error}</small>}<button className="markdown-insert-confirm" type="submit">插入链接</button></form>}
    {kind === 'callout' && <div className="markdown-template-list markdown-insert-choice-grid">{markdownTemplates.filter(item => item.group === '标注块').map(item => <button type="button" key={item.id} onClick={() => onInsert(item)}>{item.label.replace('标注 · ', '')}</button>)}</div>}
  </section>;
}

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { findPdfMatches } from './pdfSearch';
import type { PageMeta } from './types';
import '../reader-reliability.css';

export function PdfFindBar({ surface, pages, documentKey }: { surface: RefObject<HTMLDivElement | null>; pages: PageMeta[]; documentKey: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => findPdfMatches(pages, query), [pages, query]);
  const current = results.matches[index];
  useEffect(() => { setOpen(false); setQuery(''); setIndex(0); }, [documentKey]);
  useEffect(() => {
    const node = surface.current;
    const show = () => { setOpen(true); requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); }); };
    node?.addEventListener('reader-find', show);
    return () => node?.removeEventListener('reader-find', show);
  }, [surface]);
  useEffect(() => {
    const node = surface.current;
    if (!node || !open) return;
    for (const match of results.matches) for (const i of match.indices) {
      node.querySelector<HTMLElement>(`.pdf-page[data-page="${match.page}"] [data-text-index="${i}"]`)?.setAttribute('data-pdf-find', 'match');
    }
    let first: HTMLElement | null = null;
    if (current) for (const i of current.indices) {
      const span = node.querySelector<HTMLElement>(`.pdf-page[data-page="${current.page}"] [data-text-index="${i}"]`);
      span?.setAttribute('data-pdf-find', 'current'); first ??= span;
    }
    const scroller = node.querySelector<HTMLElement>('.pdf-document');
    if (scroller && first) {
      const box = first.getBoundingClientRect(), viewport = scroller.getBoundingClientRect();
      scroller.scrollTop += box.top - viewport.top - scroller.clientHeight / 3;
      if (box.left < viewport.left || box.right > viewport.right) scroller.scrollLeft += box.left - viewport.left - 24;
    }
    return () => node.querySelectorAll('[data-pdf-find]').forEach(span => span.removeAttribute('data-pdf-find'));
  }, [surface, open, results, current]);
  const close = () => { setOpen(false); surface.current?.querySelector<HTMLElement>('.pdf-document')?.focus({ preventScroll: true }); };
  const move = (step: number) => setIndex(i => results.matches.length ? (i + step + results.matches.length) % results.matches.length : 0);
  if (!open) return <button type="button" className="pdf-find-trigger" title="搜索当前 PDF（Ctrl+F）" onClick={() => { setOpen(true); requestAnimationFrame(() => input.current?.focus()); }}>查找</button>;
  const hasText = pages.some(page => page.textItems.some(item => item.text.trim()));
  return <div className="pdf-find-bar" role="search" aria-label="搜索当前 PDF" onPointerDown={e => e.stopPropagation()} onKeyDown={e => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'Enter') { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); input.current?.select(); }
  }}>
    <input ref={input} aria-label="查找文本" maxLength={200} value={query} onChange={e => { setQuery(e.target.value); setIndex(0); }} placeholder="在当前 PDF 中查找" />
    <span role="status" aria-live="polite">{!hasText ? '没有可搜索文本，扫描件需先 OCR' : !query.trim() ? '输入关键词' : results.matches.length ? `${index + 1}/${results.matches.length}${results.truncated ? '（仅前2000项）' : ''}` : '未找到匹配'}</span>
    <button type="button" disabled={!results.matches.length} aria-label="上一个匹配" onClick={() => move(-1)}>↑</button>
    <button type="button" disabled={!results.matches.length} aria-label="下一个匹配" onClick={() => move(1)}>↓</button>
    <button type="button" aria-label="关闭搜索" onClick={close}>×</button>
  </div>;
}

import { useLayoutEffect, useRef, useState } from 'react';
import { summaryExcerpt } from '../../core/librarySummary';

/** Keep all text; the measured cell, not a character budget, decides what fits. */
export function SummaryExcerpt({ value }: { value: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [box, setBox] = useState({ lines: 1, height: 20 });
  useLayoutEffect(() => {
    const node = ref.current, cell = node?.closest<HTMLElement>('.summary-cell');
    if (!node || !cell) return;
    const measure = () => {
      const style = getComputedStyle(cell), text = getComputedStyle(node);
      const line = parseFloat(text.lineHeight);
      if (!Number.isFinite(line) || line <= 0) return;
      const available = Math.max(0, cell.clientHeight - parseFloat(style.paddingTop || '0') - parseFloat(style.paddingBottom || '0'));
      const lines = Math.floor(available / line), height = lines * line;
      setBox(old => old.lines === lines && old.height === height ? old : { lines, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(cell); observer.observe(node);
    document.fonts.addEventListener('loadingdone', measure);
    return () => { observer.disconnect(); document.fonts.removeEventListener('loadingdone', measure); };
  }, []);
  return <p ref={ref} className="summary-excerpt" style={{ WebkitLineClamp: Math.max(1, box.lines), maxHeight: box.height }}>{summaryExcerpt(value).replaceAll('〔图片〕', '')}</p>;
}

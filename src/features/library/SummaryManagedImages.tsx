import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { MarkdownFigure } from '../../shared/markdown';
import { summaryImage } from '../../platform/library/summaries';
import './summary-managed-images.css';

type MarkdownNode = { type: string; children?: MarkdownNode[]; url?: string; alt?: string; title?: string };
/** Operates on the parsed AST: image-like text in code/HTML is never an asset. */
function imagesOnly() {
  return (tree: MarkdownNode) => {
    const images: MarkdownNode[] = [];
    const visit = (node: MarkdownNode) => {
      if (node.type === 'image') images.push(node);
      else if (node.type !== 'code' && node.type !== 'inlineCode' && node.type !== 'html') node.children?.forEach(visit);
    };
    visit(tree); tree.children = images.map(image => ({ type: 'paragraph', children: [image] }));
  };
}
export function SummaryManagedImage({ paperId, source, alt, title }: { paperId: string; source?: string; alt?: string; title?: string }) {
  const name = /^summary-assets\/([a-zA-Z0-9][a-zA-Z0-9.-]*\.(?:png|jpe?g|webp))$/.exec(source ?? '')?.[1];
  const identity = `${paperId}:${name ?? ''}`;
  const [result, setResult] = useState({ identity: '', url: '', failed: false });
  useEffect(() => {
    if (!name) return;
    let alive = true, objectUrl = '';
    void summaryImage(paperId, name).then(blob => {
      if (alive) { objectUrl = URL.createObjectURL(blob); setResult({ identity, url: objectUrl, failed: false }); }
    }).catch(() => { if (alive) setResult({ identity, url: '', failed: true }); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [paperId, name, identity]);
  if (!name) return <span className="summary-muted">〔非托管图片未加载〕</span>;
  const current = result.identity === identity ? result : null;
  return <span className="summary-managed-image" onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    {current?.url ? <MarkdownFigure src={current.url} alt={alt ?? '图片'} title={title} /> : <span className="summary-muted">{current?.failed ? '图片资源缺失，请检查或恢复备份' : '图片加载中…'}</span>}
  </span>;
}
export function SummaryCompactImages({ paperId, value }: { paperId: string; value: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(24);
  useLayoutEffect(() => {
    const cell = root.current?.closest<HTMLElement>('.summary-cell'); if (!cell) return;
    const measure = () => {
      const style = getComputedStyle(cell);
      const available = cell.clientHeight - parseFloat(style.paddingTop || '0') - parseFloat(style.paddingBottom || '0') - 12;
      setHeight(Math.max(1, Math.min(44, available)));
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(cell); return () => observer.disconnect();
  }, []);
  return <div ref={root} style={{ '--summary-thumbnail-height': `${height}px` } as React.CSSProperties} className="summary-compact-images"><ReactMarkdown skipHtml remarkPlugins={[imagesOnly]} components={{
    p: ({children}) => <span className="summary-compact-image-item">{children}</span>,
    img: ({src,alt,title}) => <SummaryManagedImage paperId={paperId} source={typeof src === 'string' ? src : undefined} alt={alt} title={title} />,
  }}>{value}</ReactMarkdown></div>;
}

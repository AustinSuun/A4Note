import { useEffect, useState } from 'react';
import { MarkdownFigure } from '../../shared/markdown';
import { paperNoteImageDocument } from '../../core/paperImageReference';
import { loadNoteImage } from '../explorer/noteImageLoader';
import { directNoteImage } from '../explorer/noteImageSource';

export function PaperNoteImage({ paperId, src, alt, title }: { paperId: string; src?: string; alt?: string; title?: string }) {
  const key = `${paperId}\n${src ?? ''}`;
  const [result, setResult] = useState({ key: '', url: '', error: '' });
  useEffect(() => {
    if (!src || directNoteImage(src)) return;
    let active = true;
    void loadNoteImage(paperNoteImageDocument(paperId, 'read'), src).then(url => {
      if (active) setResult({ key, url, error: '' });
    }).catch(error => { if (active) setResult({ key, url: '', error: String(error) }); });
    return () => { active = false; };
  }, [paperId, src, key]);
  if (src && directNoteImage(src)) return <MarkdownFigure src={src} alt={alt} title={title} />;
  const current = result.key === key ? result : null;
  if (current?.url) return <MarkdownFigure src={current.url} alt={alt} title={title} />;
  return <span role={current?.error ? 'alert' : 'status'} title={current?.error || src} className="markdown-image-missing">
    {current?.error ? `图片无法加载：${alt || src || '缺少引用'}。请检查论文图片资源或从备份恢复。` : '正在加载本地图片…'}
  </span>;
}

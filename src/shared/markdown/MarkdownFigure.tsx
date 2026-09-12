import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn } from 'lucide-react';

/**
 * Image with an optional caption and click-to-zoom.
 *
 * Markdown carries two texts for an image: `alt` describes it for assistive
 * tech, `title` (`![alt](src "title")`) is authored for the reader. Only the
 * title becomes a visible caption — promoting alt would print a description
 * under every image that was never written to be read.
 *
 * Path resolution stays with the caller: the notes tab reads workspace-relative
 * files through the platform layer, while reader notes are database-backed and
 * have no base directory, so `src` arrives already usable here.
 */
export function MarkdownFigure({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  const [zoomed, setZoomed] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!zoomed) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') setZoomed(false);
      // The close button is the only interactive element in this dialog.
      else closeRef.current?.focus({ preventScroll: true });
    };
    const containFocus = (event: FocusEvent) => {
      if (event.target !== closeRef.current) closeRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', containFocus);
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', containFocus);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [zoomed]);

  if (!src) return null;
  const caption = title?.trim() ?? '';
  const description = alt?.trim() || caption;

  const image = (
    <button
      type="button"
      className="markdown-image-zoom"
      title={description ? `放大：${description}` : '放大图片'}
      aria-label={description ? `放大图片：${description}` : '放大图片'}
      onClick={() => setZoomed(true)}
    >
      <img src={src} alt={alt ?? ''} loading="lazy" />
      <span className="markdown-image-zoom-hint" aria-hidden="true"><ZoomIn size={15} /></span>
    </button>
  );

  return (
    <>
      {caption
        ? <span className="markdown-figure" role="figure" aria-label={caption}>{image}<span className="markdown-figcaption">{caption}</span></span>
        : image}
      {zoomed && createPortal(
        <div
          className="markdown-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={description || '图片预览'}
          onClick={() => setZoomed(false)}
        >
          <button ref={closeRef} type="button" className="markdown-lightbox-close" title="关闭" aria-label="关闭图片预览" onClick={() => setZoomed(false)}>
            <X size={18} aria-hidden="true" />
          </button>
          <figure className="markdown-lightbox-figure" onClick={(event) => event.stopPropagation()}>
            <img src={src} alt={alt ?? ''} />
            {caption && <figcaption>{caption}</figcaption>}
          </figure>
        </div>,
        document.body,
      )}
    </>
  );
}

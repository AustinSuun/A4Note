import { CornerUpLeft } from 'lucide-react';
import { useEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** IDs are local to this rendered note: parallel/hidden notes may repeat them. */
function footnoteTarget(source: HTMLElement, href?: string): HTMLElement | undefined {
  if (!href?.startsWith('#')) return;
  let id: string;
  try { id = decodeURIComponent(href.slice(1)); } catch { return; }
  return Array.from(source.closest('.md-body')?.querySelectorAll<HTMLElement>('[id]') ?? [])
    .find(element => element.id === id);
}

function navigateFootnote(event: MouseEvent<HTMLAnchorElement>, href?: string) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const target = footnoteTarget(event.currentTarget, href);
  if (!target) return;
  // Do not change the application hash or let another note consume the anchor.
  target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  const temporaryTabIndex = !target.hasAttribute('tabindex') && !target.matches('a[href], button, input, textarea, select');
  if (temporaryTabIndex) {
    target.tabIndex = -1;
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
  }
  target.focus({ preventScroll: true });
}

/**
 * Footnote reference with hover preview.
 *
 * When the user hovers a footnote marker like [1], a popover appears with the
 * footnote content so they can decide whether to jump or keep reading. The
 * preview is extracted from the `.footnotes` section at the bottom of the
 * rendered document.
 */
export function MarkdownFootnoteRef({ href, id, children }: { href?: string; id?: string; children?: ReactNode }) {
  const [preview, setPreview] = useState<{ x: number; y: number; html: string } | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const showPreview = (event: MouseEvent<HTMLAnchorElement> | FocusEvent<HTMLAnchorElement>) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();

    const footnoteElement = footnoteTarget(target, href);
    if (!footnoteElement) return;

    // Clone and clean: remove the backref link
    const clone = footnoteElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-footnote-backref]').forEach(link => link.remove());
    clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));

    const x = rect.left + rect.width / 2;
    const y = rect.bottom + 6;
    setPreview({ x, y, html: clone.innerHTML });
  };

  const hidePreview = () => {
    timeoutRef.current = window.setTimeout(() => setPreview(null), 100);
  };

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  return (
    <>
      {/* GFM already provides the surrounding sup; do not nest another one. */}
        <a
          href={href}
          id={id}
          className="footnote-ref"
          aria-label="查看脚注"
          onClick={(event) => { if (timeoutRef.current) clearTimeout(timeoutRef.current); setPreview(null); navigateFootnote(event, href); }}
          data-footnote-ref="true"
          onMouseEnter={showPreview}
          onMouseLeave={hidePreview}
          onFocus={showPreview}
          onBlur={hidePreview}
        >
          {children}
        </a>
      {preview && createPortal(
        <div
          className="markdown-footnote-preview"
          style={{
            left: `${preview.x}px`,
            top: `${preview.y}px`,
            transform: 'translateX(-50%)',
          }}
          dangerouslySetInnerHTML={{ __html: preview.html }}
        />,
        document.body
      )}
    </>
  );
}

/**
 * Footnote backref (the return arrow at the end of each footnote).
 *
 * Replaces the default `↩` character with a lucide icon.
 */
export function MarkdownFootnoteBackref({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a href={href} className="markdown-footnote-backref" data-footnote-backref="true" title="返回正文中的脚注引用位置" aria-label="返回正文中的脚注引用位置" onClick={(event) => navigateFootnote(event, href)}>
      <CornerUpLeft size={20} aria-hidden="true" /><span>返回正文</span>
    </a>
  );
}

/**
 * Footnotes section wrapper.
 *
 * Adds a visible heading so the section is clearly separated from the body.
 */
export function MarkdownFootnotesSection({ children }: { children?: ReactNode }) {
  return (
    <section className="footnotes" data-footnotes="true">
      <h2 className="markdown-footnotes-heading">注释</h2>
      {children}
    </section>
  );
}

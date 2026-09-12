import { CornerUpLeft } from 'lucide-react';
import { useEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Footnote reference with hover preview.
 *
 * When the user hovers a footnote marker like [1], a popover appears with the
 * footnote content so they can decide whether to jump or keep reading. The
 * preview is extracted from the `.footnotes` section at the bottom of the
 * rendered document.
 */
export function MarkdownFootnoteRef({ href, children }: { href?: string; children?: ReactNode }) {
  const [preview, setPreview] = useState<{ x: number; y: number; html: string } | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const showPreview = (event: MouseEvent<HTMLAnchorElement> | FocusEvent<HTMLAnchorElement>) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();

    // Extract footnote ID from href (#user-content-fn-1)
    const footnoteId = href?.replace(/^#/, '');
    if (!footnoteId) return;

    // Find the footnote content in the document
    const footnoteElement = document.getElementById(footnoteId);
    if (!footnoteElement) return;

    // Clone and clean: remove the backref link
    const clone = footnoteElement.cloneNode(true) as HTMLElement;
    const backref = clone.querySelector('[data-footnote-backref]');
    if (backref) backref.remove();

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
      <sup className="footnote-ref">
        <a
          href={href}
          data-footnote-ref="true"
          onMouseEnter={showPreview}
          onMouseLeave={hidePreview}
          onFocus={showPreview}
          onBlur={hidePreview}
        >
          {children}
        </a>
      </sup>
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
    <a href={href} className="markdown-footnote-backref" data-footnote-backref="true" title="返回正文" aria-label="返回正文">
      <CornerUpLeft size={13} aria-hidden="true" />
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

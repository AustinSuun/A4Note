import { useEffect, useState, type MouseEvent, type PointerEvent } from 'react';
import type * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { loadPageLinks, type PdfPageLink } from './pdfLinks';
import type { PageMeta } from './types';
import './pdf-links.css';

/** One-shot opacity flash over the line a link jump (or a return) landed on. */
export type PdfLinkFlash = { page: number; yPercent: number; heightPercent: number; token: number };

export type PdfLinkLayerConfig = {
  pdfDocument: pdfjsLib.PDFDocumentProxy;
  onActivate: (link: PdfPageLink, pageNumber: number) => void;
};

export type PdfLinkLayerProps = PdfLinkLayerConfig & {
  pageMeta: PageMeta;
  /** True while the page is near the viewport; links load lazily on the first activation. */
  active: boolean;
  flash: PdfLinkFlash | null;
};

/**
 * Link annotations of one page, painted inside the page's `.pdf-render-layer` between the text layer and
 * the annotation overlay (card e4c2fa22). Boxes are page percentages, so they follow zoom and rotation for
 * free. Pointer policy lives in pdf-links.css: links take the pointer only in the cursor tool, never while a
 * text drag or a space-pan is in progress; every other tool sees straight through the layer.
 */
export function PdfLinkLayer({ pdfDocument, pageMeta, active, onActivate, flash }: PdfLinkLayerProps) {
  const [loaded, setLoaded] = useState<{ pageMeta: PageMeta; links: PdfPageLink[] } | null>(null);
  const links = loaded?.pageMeta === pageMeta ? loaded.links : null;

  useEffect(() => {
    if (!active || links) return;
    let cancelled = false;
    void loadPageLinks(pdfDocument, pageMeta)
      .then((result) => { if (!cancelled) setLoaded({ pageMeta, links: result }); })
      .catch((error) => {
        console.warn('PDF link annotations unavailable', error);
        if (!cancelled) setLoaded({ pageMeta, links: [] });
      });
    return () => { cancelled = true; };
  }, [active, links, pdfDocument, pageMeta]);

  const stopPrimaryButton = (event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    // Keep the native selection anchor out of the link box and the page's cursor-mode handlers quiet;
    // middle / right buttons still bubble so panning and context menus behave as before.
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="pdf-link-layer" data-reader-layer="links" data-link-state={links ? 'ready' : active ? 'loading' : 'idle'} data-link-count={links?.length ?? 0}>
      {links?.map((link) => (
        <button
          key={link.id}
          type="button"
          className={`pdf-link pdf-link-${link.action.kind}`}
          aria-label={link.label}
          data-tip={link.label}
          data-tip-side={link.rect.leftPercent + link.rect.widthPercent / 2 > 55 ? 'right' : 'left'}
          tabIndex={-1}
          data-link-kind={link.action.kind}
          data-link-page={link.target?.pageNumber ?? undefined}
          style={{ left: `${link.rect.leftPercent}%`, top: `${link.rect.topPercent}%`, width: `${link.rect.widthPercent}%`, height: `${link.rect.heightPercent}%` }}
          onPointerDown={stopPrimaryButton}
          onMouseDown={stopPrimaryButton}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onActivate(link, pageMeta.pageNumber);
          }}
        />
      ))}
      {flash && flash.page === pageMeta.pageNumber && (
        <div key={flash.token} className="pdf-link-flash" data-reader-layer="link-flash" style={{ top: `${flash.yPercent}%`, height: `${flash.heightPercent}%` }} aria-hidden="true" />
      )}
    </div>
  );
}

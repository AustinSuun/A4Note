import { useEffect, useState } from 'react';
import { useShortcutProps } from '../../../shared/shortcuts/ShortcutProvider';
import { zh } from '../../../ui/zh';
import type { PdfLinkOrigin } from './pdfLinkHistory';
import './pdf-links.css';

/** Matches the CSS transition; the node is removed only after the fade-out has played. */
export const PDF_LINK_BACK_FADE_MS = 180;

/**
 * 「返回 第 N 页」 after a link jump (card e4c2fa22). Sits on the right of the reading surface, below the
 * note edge handle; enters and leaves with opacity/transform only. The Alt+← binding is dispatched by the
 * shortcut system as `reader.linkBack` (readerNavigation.requestPdfLinkBack) and lands on the same handler.
 */
export function PdfLinkBackButton({ origin, onBack }: { origin: PdfLinkOrigin | null; onBack: () => void }) {
  const [shown, setShown] = useState<PdfLinkOrigin | null>(origin);
  const [visible, setVisible] = useState(false);
  const shortcutProps = useShortcutProps();

  useEffect(() => {
    if (origin) {
      setShown(origin);
      const frame = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setShown(null), PDF_LINK_BACK_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [origin]);

  if (!shown) return null;
  return (
    <button
      type="button"
      className={`pdf-link-back${visible ? ' is-visible' : ''}`}
      {...shortcutProps('reader.linkBack', zh.reader.linkBackTitle)}
      data-reader-layer="link-back"
      data-link-back-page={shown.page}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); onBack(); }}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H6" />
        <path d="m12 5-7 7 7 7" />
      </svg>
      <span>{zh.reader.linkBack} 第 {shown.page} 页</span>
    </button>
  );
}

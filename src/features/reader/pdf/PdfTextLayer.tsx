import { memo, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { fitTextRunsToPdfBoxes } from './pdfTextLayerFit';
import type { TextItemBox, TextOrientation } from './types';

// `sideways-lr` flows bottom→top without a transform (Chromium 132+); older engines fall back to
// a flipped vertical-rl run, which still hit-tests but extends drag selections less reliably.
const supportsSidewaysLr = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('writing-mode', 'sideways-lr');

/** Lay a rotated run out along the direction pdf.js painted it, so native selection and
 * `getClientRects` follow the glyphs instead of a horizontal box hanging off the page. The text
 * itself is transparent, so only the character order and flow direction matter: 90 flows
 * top→bottom, 270 bottom→top, and 180 reverses the characters right→left (no transform, because
 * Chromium does not extend drag selections across a 180° rotated inline box).
 * The run-fit scale (`--pdf-run-scale`, see pdfTextLayerFit) rides along the flow axis; the legacy
 * 270 fallback composes it with the flip and re-anchors the top edge, because that flip needs a
 * centred origin. */
function textOrientationStyle(orientation: TextOrientation | undefined): CSSProperties {
  if (orientation === 90) return { writingMode: 'vertical-rl', textOrientation: 'sideways' };
  if (orientation === 270) return supportsSidewaysLr ? { writingMode: 'sideways-lr' as CSSProperties['writingMode'] } : { writingMode: 'vertical-rl', textOrientation: 'sideways', transform: 'translateY(calc((var(--pdf-run-scale, 1) - 1) * 50%)) rotate(180deg) scaleY(var(--pdf-run-scale, 1))', transformOrigin: 'center' };
  if (orientation === 180) return { direction: 'rtl', unicodeBidi: 'bidi-override' };
  return {};
}

/** The box along the flow axis is left to the glyphs (`max-content`) and scaled onto the PDF run
 * afterwards; only the cross axis takes the pdf.js measurement directly. A fixed flow-axis width
 * would clip or pad the substitute font's advance, so the caret position under the pointer and
 * the character offset would drift apart along the run (visibly at high zoom). */
function textRunBoxStyle(item: TextItemBox): CSSProperties {
  const vertical = item.orientation === 90 || item.orientation === 270;
  return vertical
    ? { left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: 'max-content' }
    : { left: `${item.x}%`, top: `${item.y}%`, width: 'max-content', height: `${item.height}%` };
}

function PdfTextLayerView({
  textItems,
  zoom,
  selectable,
}: {
  textItems: TextItemBox[];
  zoom: number;
  selectable: boolean;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  // Measure after every relayout of the runs (new page text, zoom → font size, selectable padding)
  // and before paint, so the fitted runs never flash at their natural width. Fonts that finish
  // loading later change the advances, and a layer that was hidden (inactive tab, released page)
  // has no box to measure against, so fit again when the fonts settle or the layer resizes.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    let cancelled = false;
    const fit = () => { if (!cancelled) fitTextRunsToPdfBoxes(layer, textItems); };
    fit();
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (fonts && fonts.status === 'loading') void fonts.ready.then(fit);
    let lastWidth = layer.getBoundingClientRect().width;
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          const width = layer.getBoundingClientRect().width;
          if (width === lastWidth) return;
          lastWidth = width;
          fit();
        })
      : null;
    observer?.observe(layer);
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [textItems, zoom, selectable]);
  return (
    <div ref={layerRef} className={selectable ? 'pdf-text-layer selectable' : 'pdf-text-layer'} data-reader-layer="text" aria-hidden={!selectable}>
      {textItems.map((item, index) => (
        <span
          key={`${index}-${item.x}-${item.y}`}
          data-text-index={index}
          data-text-orientation={item.orientation || undefined}
          style={{
            ...textRunBoxStyle(item),
            fontSize: `${Math.max(item.fontSize * zoom, 6)}px`,
            ...textOrientationStyle(item.orientation),
          }}
        >
          {item.text}
        </span>
      ))}
    </div>
  );
}

const MemoPdfTextLayer = memo(PdfTextLayerView, (previous, next) => previous.textItems === next.textItems && previous.zoom === next.zoom && previous.selectable === next.selectable);

export function PdfTextLayer(props: { textItems: TextItemBox[]; zoom: number; selectable: boolean }) {
  return <MemoPdfTextLayer {...props} />;
}

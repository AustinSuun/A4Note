import { memo, type CSSProperties } from 'react';
import type { TextItemBox, TextOrientation } from './types';

// `sideways-lr` flows bottom→top without a transform (Chromium 132+); older engines fall back to
// a flipped vertical-rl run, which still hit-tests but extends drag selections less reliably.
const supportsSidewaysLr = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('writing-mode', 'sideways-lr');

/** Lay a rotated run out along the direction pdf.js painted it, so native selection and
 * `getClientRects` follow the glyphs instead of a horizontal box hanging off the page. The text
 * itself is transparent, so only the character order and flow direction matter: 90 flows
 * top→bottom, 270 bottom→top, and 180 reverses the characters right→left (no transform, because
 * Chromium does not extend drag selections across a 180° rotated inline box). */
function textOrientationStyle(orientation: TextOrientation | undefined): CSSProperties {
  if (orientation === 90) return { writingMode: 'vertical-rl', textOrientation: 'sideways' };
  if (orientation === 270) return supportsSidewaysLr ? { writingMode: 'sideways-lr' as CSSProperties['writingMode'] } : { writingMode: 'vertical-rl', textOrientation: 'sideways', transform: 'rotate(180deg)', transformOrigin: 'center' };
  if (orientation === 180) return { direction: 'rtl', unicodeBidi: 'bidi-override' };
  return {};
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
  return (
    <div className={selectable ? 'pdf-text-layer selectable' : 'pdf-text-layer'} data-reader-layer="text" aria-hidden={!selectable}>
      {textItems.map((item, index) => (
        <span
          key={`${index}-${item.x}-${item.y}`}
          data-text-index={index}
          data-text-orientation={item.orientation || undefined}
          style={{
            left: `${item.x}%`,
            top: `${item.y}%`,
            width: `${item.width}%`,
            height: `${item.height}%`,
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

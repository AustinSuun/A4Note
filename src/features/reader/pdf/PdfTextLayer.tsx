import { memo, type CSSProperties } from 'react';
import type { TextItemBox, TextOrientation } from './types';

/** Lay a rotated run out along the direction pdf.js painted it, so native selection and
 * `getClientRects` follow the glyphs instead of a horizontal box hanging off the page. */
function textOrientationStyle(orientation: TextOrientation | undefined): CSSProperties {
  if (orientation === 90) return { writingMode: 'vertical-rl', textOrientation: 'sideways' };
  if (orientation === 270) return { writingMode: 'vertical-rl', textOrientation: 'sideways', transform: 'rotate(180deg)', transformOrigin: 'center' };
  if (orientation === 180) return { transform: 'rotate(180deg)', transformOrigin: 'center' };
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

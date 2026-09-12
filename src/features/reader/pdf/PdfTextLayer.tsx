import { memo } from 'react';
import type { TextItemBox } from './types';

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
          style={{
            left: `${item.x}%`,
            top: `${item.y}%`,
            width: `${item.width}%`,
            height: `${item.height}%`,
            fontSize: `${Math.max(item.fontSize * zoom, 6)}px`,
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

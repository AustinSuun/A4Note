import type { TextItemBox } from './types';

export function PdfTextLayer({
  textItems,
  zoom,
  selectable,
}: {
  textItems: TextItemBox[];
  zoom: number;
  selectable: boolean;
}) {
  return (
    <div className={selectable ? 'pdf-text-layer selectable' : 'pdf-text-layer'} aria-hidden={!selectable}>
      {textItems.map((item, index) => (
        <span
          key={`${index}-${item.x}-${item.y}`}
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

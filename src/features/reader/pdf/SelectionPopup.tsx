import type { AnnotationColor } from '../../../core/types';
import { AnnotationToolIcon } from '../ReaderIcons';

type SelectionPopupProps = {
  visible: boolean;
  x: number;
  y: number;
  activeAnnotationColor: AnnotationColor;
  onHighlight: () => void;
  onUnderline: () => void;
};

/**
 * 文字选中后在鼠标附近弹出的快捷标注工具。
 * 仅在 cursor 模式下显示。
 */
export function SelectionPopup({
  visible,
  x,
  y,
  activeAnnotationColor,
  onHighlight,
  onUnderline,
}: SelectionPopupProps) {
  if (!visible) return null;

  return (
    <div
      className="selection-popup"
      style={{ left: x, top: y }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="selection-popup-btn"
        title="高亮"
        onClick={onHighlight}
      >
        <AnnotationToolIcon id="highlight" />
      </button>
      <button
        type="button"
        className="selection-popup-btn"
        title="下划线"
        onClick={onUnderline}
      >
        <AnnotationToolIcon id="underline" />
      </button>
      <span
        className="selection-popup-color"
        style={{ background: annotationColorToCss(activeAnnotationColor) }}
        title="当前颜色"
      />
    </div>
  );
}

function annotationColorToCss(color: AnnotationColor): string {
  if (color.startsWith('#')) return color;
  const map: Record<string, string> = {
    yellow: 'rgba(255,229,121,.95)',
    green: 'rgba(100,180,130,.88)',
    blue: 'rgba(92,142,219,.9)',
    purple: 'rgba(151,112,219,.88)',
  };
  return map[color] ?? '#f2c94c';
}

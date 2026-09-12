import { AnnotationToolIcon } from '../ReaderIcons';

type SelectionPopupProps = {
  visible: boolean;
  x: number;
  y: number;
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
    </div>
  );
}

import { AnnotationToolIcon } from '../ReaderIcons';
import type { SelectionPopupAnchor } from './pdfSelectionPopup';

type SelectionPopupProps = {
  /** Page-percentage anchor (see `selectionPopupAnchor`); the popup is rendered inside the page's render layer. */
  anchor: SelectionPopupAnchor;
  onHighlight: () => void;
  onUnderline: () => void;
};

/**
 * 文字选中后挂在选区所在行上方（页面顶部放不下时挂在末行下方）的快捷标注工具。
 * 仅在 cursor 模式下显示；锚点与选区预览、落盘标注共用同一套页面百分比几何。
 */
export function SelectionPopup({
  anchor,
  onHighlight,
  onUnderline,
}: SelectionPopupProps) {
  return (
    <div
      className={`selection-popup ${anchor.placement}`}
      data-placement={anchor.placement}
      style={{ left: `${anchor.x}%`, top: `${anchor.y}%` }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
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

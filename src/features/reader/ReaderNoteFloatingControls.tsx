import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { FLOATING_CORNERS, moveFloatingRect, resizeFloatingRect, type FloatingCorner } from './noteEnterMotion';
import type { FloatingCardRect } from './noteWorkbench';

const CORNER_LABELS: Record<FloatingCorner, string> = { nw: '左上角', ne: '右上角', sw: '左下角', se: '右下角' };
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Drag lane plus four corner grips for the floating 速记卡. Pointer moves are pointer-captured
 *  on the pressed control and expressed as workspace ratios, so the geometry stays valid across
 *  window resizes and UI zoom; every control is also keyboard operable. Rendered as an absolute
 *  sibling of the card so its arcs can sit outside the card's rounded corners. */
export function ReaderNoteFloatingControls({ active, rect, containerRef, onRectChange, onEscape }: {
  active: boolean;
  rect: FloatingCardRect;
  containerRef: RefObject<HTMLElement | null>;
  onRectChange: (next: FloatingCardRect) => void;
  onEscape?: () => void;
}) {
  const track = (event: ReactPointerEvent<HTMLButtonElement>, apply: (dx: number, dy: number) => FloatingCardRect) => {
    const container = containerRef.current;
    if (!container || event.button !== 0) return;
    const box = container.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    element.dataset.active = 'true';
    const move = (moveEvent: PointerEvent) => {
      onRectChange(apply((moveEvent.clientX - startX) / Math.max(1, box.width), (moveEvent.clientY - startY) / Math.max(1, box.height)));
    };
    const stop = () => {
      delete element.dataset.active;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', stop);
      element.removeEventListener('pointercancel', stop);
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', stop);
    element.addEventListener('pointercancel', stop);
  };
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const origin = { ...rect };
    track(event, (dx, dy) => moveFloatingRect(origin, dx, dy));
  };
  const startResize = (corner: FloatingCorner) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    const origin = { ...rect };
    track(event, (dx, dy) => resizeFloatingRect(origin, corner, dx, dy));
  };
  const nudge = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') { if (onEscape) { event.preventDefault(); onEscape(); } return; }
    const arrow = ARROWS[event.key];
    if (!arrow) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.05 : 0.02;
    onRectChange(moveFloatingRect(rect, arrow[0] * step, arrow[1] * step));
  };
  const nudgeCorner = (corner: FloatingCorner) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const arrow = ARROWS[event.key];
    if (!arrow) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.05 : 0.02;
    onRectChange(resizeFloatingRect(rect, corner, arrow[0] * step, arrow[1] * step));
  };
  return (
    <div className="reader-note-floating-controls" inert={!active} aria-hidden={!active}>
      <button type="button" className="reader-note-floating-drag" aria-label="拖动悬浮速记卡（方向键微调，Escape 回到分屏）"
        onPointerDown={startDrag} onKeyDown={nudge}>
        <span className="reader-note-floating-grip" aria-hidden="true" />
      </button>
      {FLOATING_CORNERS.map(corner => (
        <button key={corner} type="button" className="reader-note-floating-corner" data-corner={corner}
          aria-label={`从${CORNER_LABELS[corner]}调整悬浮速记卡大小（方向键微调）`}
          onPointerDown={startResize(corner)} onKeyDown={nudgeCorner(corner)} />
      ))}
    </div>
  );
}

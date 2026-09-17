import { useEffect, useRef } from 'react';

export type RowResizeActions = {
  resizeRow(id: string, height: number | undefined, save: boolean): void;
  resizeScale(): number;
  canResize(): boolean;
  stopZoom(): void;
};
export function SummaryRowResizer({ id, title, height, manualHeight, actions }: {
  id: string; title: string; height: number; manualHeight?: number;
  actions: { current: RowResizeActions };
}) {
  const drag = useRef<{ pointer: number; y: number; start: number; original?: number; value: number; scale: number } | null>(null);
  const frame = useRef(0);
  const cancel = () => {
    cancelAnimationFrame(frame.current); frame.current = 0;
    const state = drag.current; drag.current = null;
    if (state) actions.current.resizeRow(id, state.original, false);
  };
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    if (drag.current) actions.current.resizeRow(id, drag.current.original, false);
  }, [actions, id]);
  return <span className="summary-row-resizer" role="separator" aria-orientation="horizontal"
    aria-label={`调整行高：${title}`} aria-valuemin={44} aria-valuemax={2000} aria-valuenow={Math.min(2000, Math.max(44, height))}
    aria-disabled={!actions.current.canResize()} tabIndex={actions.current.canResize() ? 0 : -1}
    onClick={event => event.stopPropagation()}
    onPointerDown={event => {
      if (event.button !== 0 || !actions.current.canResize()) return;
      event.preventDefault(); event.stopPropagation(); actions.current.stopZoom();
      event.currentTarget.focus({ preventScroll: true });
      drag.current = { pointer: event.pointerId, y: event.clientY, start: height, original: manualHeight, value: height, scale: actions.current.resizeScale() };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const state = drag.current; if (!state || event.pointerId !== state.pointer) return;
      state.value = Math.max(44, Math.min(2000, Math.round(state.start + (event.clientY - state.y) / state.scale)));
      if (!frame.current) frame.current = requestAnimationFrame(() => {
        frame.current = 0; if (drag.current) actions.current.resizeRow(id, drag.current.value, false);
      });
    }}
    onPointerUp={event => {
      const state = drag.current; if (!state || state.pointer !== event.pointerId) return;
      cancelAnimationFrame(frame.current); frame.current = 0; drag.current = null;
      if (state.value !== state.start) actions.current.resizeRow(id, state.value, true);
      else actions.current.resizeRow(id, state.original, false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}
    onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); cancel(); actions.current.resizeRow(id, undefined, true); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); return; }
      if (!actions.current.canResize() || !['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); actions.current.stopZoom();
      const value = event.key === 'Enter' ? undefined : event.key === 'Home' ? 44 : event.key === 'End' ? 2000 : Math.max(44, Math.min(2000, height + (event.key === 'ArrowDown' ? 1 : -1) * (event.shiftKey ? 40 : 8)));
      actions.current.resizeRow(id, value, true);
    }} />;
}

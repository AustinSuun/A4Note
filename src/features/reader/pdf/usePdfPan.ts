import { useEffect, useRef, useState, type RefObject, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';

const controls = 'input, textarea, select, button, [contenteditable="true"], [role="textbox"], dialog, [role="dialog"]';
/** Capture the gesture before PDF text/annotation handlers; never persist a hand annotation. */
export function usePdfPan(root: RefObject<HTMLDivElement | null>, handTool: boolean, sourceKey: string, beforePan: () => void) {
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const space = useRef(false);
  const gesture = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const suppressClick = useRef(false);
  const otherGesture = useRef(false);
  const finish = () => {
    const current = gesture.current;
    gesture.current = null;
    if (current && root.current?.hasPointerCapture(current.id)) root.current.releasePointerCapture(current.id);
    setIsPanning(false);
  };
  useEffect(() => {
    const inControls = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(controls));
    const keydown = (event: KeyboardEvent) => {
      const scroller = root.current;
      if (event.code !== 'Space' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || !scroller) return;
      if (inControls(event.target) || inControls(document.activeElement)) return;
      if (otherGesture.current) return; // Never turn an ongoing ink/selection gesture into a pan.
      if (scroller.closest('[aria-hidden="true"], [inert], .workbench-tab-frame:not(.active)') || !scroller.getClientRects().length) return;
      if (!scroller.matches(':hover') && !scroller.contains(document.activeElement)) return;
      event.preventDefault();
      space.current = true; setSpaceHeld(true);
    };
    const reset = () => { space.current = false; otherGesture.current = false; setSpaceHeld(false); finish(); };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space') { space.current = false; setSpaceHeld(false); }
      // A pan already holding the left button finishes on pointer-up, preventing
      // the original annotation tool from drawing during the remainder of that drag.
    };
    const clearOtherGesture = () => { otherGesture.current = false; };
    const visibility = () => { if (document.hidden) reset(); };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', reset);
    window.addEventListener('pointerup', clearOtherGesture, true);
    window.addEventListener('pointercancel', clearOtherGesture, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pointerup', clearOtherGesture, true); window.removeEventListener('pointercancel', clearOtherGesture, true);
      reset();
    };
  }, [root, sourceKey]);
  const stop = (event: ReactMouseEvent<HTMLDivElement> | ReactPointerEvent<HTMLDivElement>) => { event.preventDefault(); event.stopPropagation(); };
  const blockMouse = (event: ReactMouseEvent<HTMLDivElement>) => { if (gesture.current || (suppressClick.current && (event.buttons & 5))) stop(event); };
  return {
    spaceHeld, isPanning,
    handlers: {
      onPointerDownCapture: (event: ReactPointerEvent<HTMLDivElement>) => {
        const scroller = root.current;
        if (!scroller || !event.isPrimary) return;
        if (event.target instanceof Element && event.target.closest(controls)) { suppressClick.current = false; return; }
        const wantsPan = event.button === 1 || (event.button === 0 && (handTool || space.current));
        if (!wantsPan) { suppressClick.current = false; otherGesture.current = true; return; }
        stop(event); beforePan(); scroller.focus({ preventScroll: true });
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
        suppressClick.current = true;
        scroller.setPointerCapture(event.pointerId); setIsPanning(true);
      },
      onPointerMoveCapture: (event: ReactPointerEvent<HTMLDivElement>) => {
        const pan = gesture.current;
        if (!pan && suppressClick.current && (event.buttons & 5)) { stop(event); return; }
        if (!pan || pan.id !== event.pointerId || !root.current) return;
        stop(event);
        if (!(event.buttons & 5)) { finish(); return; }
        root.current.scrollLeft = pan.left - (event.clientX - pan.x);
        root.current.scrollTop = pan.top - (event.clientY - pan.y);
      },
      onPointerUpCapture: (event: ReactPointerEvent<HTMLDivElement>) => { if (gesture.current?.id === event.pointerId) { stop(event); finish(); } },
      onPointerCancelCapture: (event: ReactPointerEvent<HTMLDivElement>) => { if (gesture.current?.id === event.pointerId) { stop(event); finish(); } },
      onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => { if (gesture.current?.id === event.pointerId) finish(); },
      onMouseDownCapture: blockMouse,
      onMouseMoveCapture: blockMouse,
      onMouseUpCapture: (event: ReactMouseEvent<HTMLDivElement>) => { if (suppressClick.current) stop(event); },
      onClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => {
        if (!(event.target instanceof Element && event.target.closest(controls)) && (suppressClick.current || handTool || space.current)) { stop(event); suppressClick.current = false; }
      },
      onAuxClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => { if (event.button === 1 && suppressClick.current) { stop(event); suppressClick.current = false; } },
    },
  };
}

export type TitlebarGesture = 'start_dragging' | 'toggle_maximize';

const INTERACTIVE_TARGET = [
  'button', 'input', 'select', 'textarea', 'a', 'summary',
  '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="combobox"]',
  '[role="slider"]', '[role="spinbutton"]', '[role="tab"]', '[role="menuitem"]',
  '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="separator"]',
  '[contenteditable]:not([contenteditable="false"])',
  '[data-window-no-drag]', 'dialog', '[role="dialog"]', '[role="menu"]',
].join(', ');

/** Use DOM capture: a React portal bubbles through its owner, not its DOM host. */
export function bindWindowTitlebarGestures(root: HTMLElement, run: (command: TitlebarGesture) => void) {
  const isBlankArea = (event: MouseEvent) => {
    const target = event.target;
    // Element also includes SVG/path nodes inside buttons.
    if (event.button !== 0 || event.defaultPrevented || !(target instanceof Element)
      || !root.contains(target) || target.closest(INTERACTIVE_TARGET)) return false;
    // Leave a scrollable toolbar's native scrollbar available in narrow windows.
    if (target instanceof HTMLElement) {
      const rect = target.getBoundingClientRect();
      if (target.offsetHeight > target.clientHeight && target.scrollWidth > target.clientWidth
        && event.clientY >= rect.top + target.clientTop + target.clientHeight) return false;
      if (target.offsetWidth > target.clientWidth && target.scrollHeight > target.clientHeight
        && event.clientX >= rect.left + target.clientLeft + target.clientWidth) return false;
    }
    return true;
  };
  const onMouseDown = (event: MouseEvent) => {
    if (!isBlankArea(event) || event.detail > 1) return;
    event.preventDefault();
    event.stopPropagation();
    run('start_dragging');
  };
  const onDoubleClick = (event: MouseEvent) => {
    if (!isBlankArea(event)) return;
    event.preventDefault();
    event.stopPropagation();
    run('toggle_maximize');
  };
  root.addEventListener('mousedown', onMouseDown, true);
  root.addEventListener('dblclick', onDoubleClick, true);
  return () => {
    root.removeEventListener('mousedown', onMouseDown, true);
    root.removeEventListener('dblclick', onDoubleClick, true);
  };
}

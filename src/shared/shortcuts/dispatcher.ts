import { canDispatchShortcut, resolveKeyboardCommand, resolveMouseCommand, type ShortcutCommand } from '../../core/shortcuts';
import { ShortcutStore } from './store';

export function eventTargetIsEditable(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return target.matches('input, textarea, select') || (target instanceof HTMLElement && target.isContentEditable)
    || Boolean(target.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"], .cm-editor'));
}
export function elementIsVisible(element: Element | null) {
  if (!element || !element.isConnected || element.closest('[inert], [aria-hidden="true"], [hidden]')) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
}
export function modalIsOpen(doc: Document) {
  return [...doc.querySelectorAll('dialog[open], .modal-backdrop, [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')].some(elementIsVisible);
}

/** Exactly one application dispatcher. DOM-specific focus/lifecycle logic stays out of core. */
export function attachShortcutDispatcher(store: ShortcutStore, win: Window = window) {
  const doc = win.document;
  let composing = false, controlDown = false, usedChord = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const consumedButtons = new Set<number>();
  const clear = () => { if (timer) clearTimeout(timer); timer = undefined; store.setHint(false); };
  const reset = () => { clear(); controlDown = false; usedChord = false; composing = false; consumedButtons.clear(); };
  let previousContext = store.context, previousRecording = store.recording;
  const unsubscribe = store.subscribe(() => {
    if (previousContext !== store.context || previousRecording !== store.recording) {
      previousContext = store.context; previousRecording = store.recording;
      clear(); usedChord = true; consumedButtons.clear();
    }
  });
  const context = (event: KeyboardEvent | MouseEvent) => ({ ...store.context,
    editable: eventTargetIsEditable(event.target) || eventTargetIsEditable(doc.activeElement),
    composing: composing || ('isComposing' in event && event.isComposing),
    altGraph: event.getModifierState?.('AltGraph') ?? false,
    modalOpen: store.context.modalOpen || modalIsOpen(doc), recording: store.recording,
  });
  const execute = (command: ShortcutCommand | undefined, event: KeyboardEvent | MouseEvent) => {
    if (!command?.execute || !canDispatchShortcut(command, context(event))) return false;
    if ('repeat' in event && event.repeat && !command.allowRepeat) return false;
    try {
      if (command.execute() === false) return false;
      event.preventDefault(); return true;
    } catch (error) { store.error = `快捷键执行失败：${String(error)}`; store.emit(); return false; }
  };
  const keydown = (event: KeyboardEvent) => {
    if (doc.visibilityState === 'hidden' || !doc.hasFocus()) { reset(); return; }
    if (!event.ctrlKey && event.key !== 'Control') { clear(); controlDown = false; usedChord = false; }
    const ctx = context(event);
    if (event.key === 'Control') {
      if (!controlDown && !event.defaultPrevented && !ctx.modalOpen && !ctx.recording && !ctx.composing && !ctx.altGraph) {
        controlDown = true; usedChord = false;
        timer = setTimeout(() => {
          timer = undefined;
          if (controlDown && !usedChord && doc.hasFocus() && doc.visibilityState !== 'hidden' && !store.recording && !modalIsOpen(doc) && !store.context.modalOpen) store.setHint(true);
        }, 150);
      }
      return;
    }
    usedChord = true; clear();
    if (event.defaultPrevented) return;
    execute(resolveKeyboardCommand(store.commands(), store.overrides, ctx, event), event);
  };
  const keyup = (event: KeyboardEvent) => { if (event.key === 'Control' || !event.ctrlKey) { controlDown = false; usedChord = false; clear(); } };
  const mousedown = (event: MouseEvent) => {
    clear();
    consumedButtons.delete(event.button);
    if (!doc.hasFocus() || event.defaultPrevented || doc.visibilityState === 'hidden') return;
    const command = resolveMouseCommand(store.commands(), store.overrides, context(event), event.button);
    if (execute(command, event)) consumedButtons.add(event.button);
  };
  // WebViews may navigate on mouseup / auxclick rather than mousedown. Only suppress
  // the continuation of a side-button gesture actually consumed by this dispatcher.
  const mouseup = (event: MouseEvent) => { if (consumedButtons.has(event.button)) event.preventDefault(); };
  const auxclick = (event: MouseEvent) => { if (consumedButtons.delete(event.button)) event.preventDefault(); };
  const compositionstart = () => { composing = true; clear(); };
  const compositionend = () => { composing = false; };
  const onFocus = () => { if (modalIsOpen(doc)) clear(); };
  win.addEventListener('keydown', keydown); win.addEventListener('keyup', keyup);
  win.addEventListener('mousedown', mousedown); win.addEventListener('mouseup', mouseup); win.addEventListener('auxclick', auxclick);
  win.addEventListener('blur', reset); doc.addEventListener('visibilitychange', reset);
  doc.addEventListener('compositionstart', compositionstart); doc.addEventListener('compositionend', compositionend); doc.addEventListener('focusin', onFocus);
  return () => {
    unsubscribe(); reset(); win.removeEventListener('keydown', keydown); win.removeEventListener('keyup', keyup);
    win.removeEventListener('mousedown', mousedown); win.removeEventListener('mouseup', mouseup); win.removeEventListener('auxclick', auxclick);
    win.removeEventListener('blur', reset); doc.removeEventListener('visibilitychange', reset);
    doc.removeEventListener('compositionstart', compositionstart); doc.removeEventListener('compositionend', compositionend); doc.removeEventListener('focusin', onFocus);
  };
}

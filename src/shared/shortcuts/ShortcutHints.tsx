import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { canDispatchShortcut, formatBinding, resolveShortcuts } from '../../core/shortcuts';
import { elementIsVisible, eventTargetIsEditable, modalIsOpen } from './dispatcher';
import { layoutShortcutHints, type HintPosition, type HintRect } from './hintLayout';
import type { ShortcutStore } from './store';

type Hint = { id: string; label: string; enabled: boolean; anchor?: Element };
const rectOf = (element: Element): HintRect => {
  const { left, top, right, bottom } = element.getBoundingClientRect();
  return { left, top, right, bottom };
};
// Scene navigation uses large grid tiles. Position by the icon and protect its
// glyph/label, not the tile's empty hit-target padding (which forced hints several
// rows away). Small toolbar buttons still protect their complete hit rectangle.
function sceneTileIcon(node: HTMLElement) {
  const rect = node.getBoundingClientRect();
  return node.matches('button[data-shortcut-id^="scene."]') && rect.width >= 96 && rect.height >= 52 ? node.querySelector('svg') : null;
}
function controlRects(node: HTMLElement): HintRect[] {
  const icon = sceneTileIcon(node);
  if (!icon) return [rectOf(node)];
  const rects = [rectOf(icon)];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent?.trim()) continue;
    const range = document.createRange(); range.selectNodeContents(walker.currentNode);
    rects.push(...[...range.getClientRects()].map(({ left, top, right, bottom }) => ({ left, top, right, bottom })));
  }
  return rects;
}
function visibleControl(node: HTMLElement) {
  if (!elementIsVisible(node) || getComputedStyle(node).opacity === '0') return false;
  const rect = node.getBoundingClientRect();
  if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return false;
  const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, (rect.left + rect.right) / 2)), Math.max(0, Math.min(innerHeight - 1, (rect.top + rect.bottom) / 2)));
  return hit === node || Boolean(hit && node.contains(hit));
}

export function ShortcutHints({ store }: { store: ShortcutStore }) {
  const revision = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const root = useRef<HTMLDivElement>(null);
  const [hints, setHints] = useState<Hint[]>([]);
  const [positions, setPositions] = useState<Record<string, HintPosition>>({});

  useLayoutEffect(() => {
    if (!store.hintVisible) return;
    let frame = 0;
    const refresh = () => {
      const context = { ...store.context, editable: eventTargetIsEditable(document.activeElement), modalOpen: store.context.modalOpen || modalIsOpen(document) };
      if (context.modalOpen) { store.setHint(false); return; }
      const nodes = [...document.querySelectorAll<HTMLElement>('[data-shortcut-id]')].filter(visibleControl);
      const seen = new Set<string>();
      setHints(resolveShortcuts(store.commands(), store.overrides, context).flatMap(({ command, bindings }): Hint[] => {
        if (seen.has(command.id) || !bindings.length) return [];
        seen.add(command.id);
        // One primary effective binding keeps the overlay compact. All alternatives
        // remain in the existing button tooltip, aria-keyshortcuts and editor.
        const node = nodes.find(node => node.dataset.shortcutId === command.id);
        return [{ id: command.id, label: formatBinding(bindings[0]), enabled: canDispatchShortcut(command, context), anchor: node ? sceneTileIcon(node) ?? node : undefined }];
      }));
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(refresh); };
    refresh();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    document.addEventListener('focusin', schedule);
    document.addEventListener('transitionend', schedule);
    document.addEventListener('animationend', schedule);
    const observer = new MutationObserver(records => {
      // Our own positioning/text writes must not feed an observer/render loop.
      if (records.some(record => !root.current?.contains(record.target))) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-shortcut-id', 'disabled'] });
    const resize = new ResizeObserver(schedule);
    resize.observe(document.documentElement);
    document.querySelectorAll('[data-shortcut-id]').forEach(node => resize.observe(node));
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect();
      window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true);
      document.removeEventListener('focusin', schedule); document.removeEventListener('transitionend', schedule); document.removeEventListener('animationend', schedule);
    };
  }, [store, revision]);

  useLayoutEffect(() => {
    if (!store.hintVisible || !root.current) return;
    const elements = [...root.current.querySelectorAll<HTMLElement>('[data-hint-id]')];
    const controls = [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="button"], [role="menuitemradio"], #a4note-live-dev-badge')].filter(visibleControl).flatMap(controlRects);
    const measurements = hints.map(hint => {
      const node = elements.find(element => element.dataset.hintId === hint.id)!;
      const rect = node.getBoundingClientRect();
      return { id: hint.id, width: Math.ceil(rect.width), height: Math.ceil(rect.height), anchor: hint.anchor ? rectOf(hint.anchor) : undefined };
    });
    setPositions(layoutShortcutHints(measurements, { left: 8, top: 8, right: innerWidth - 8, bottom: innerHeight - 8 }, controls));
  }, [hints, store, store.hintVisible]);

  return createPortal(<div ref={root} className={`shortcut-hints ${store.hintVisible ? 'is-visible' : ''}`} aria-hidden="true">
    {hints.map(hint => <kbd key={hint.id} data-hint-id={hint.id} data-hint-placement={positions[hint.id]?.placement}
      className={`shortcut-key-hint ${hint.enabled ? '' : 'is-disabled'}`}
      style={{ left: positions[hint.id]?.left ?? 0, top: positions[hint.id]?.top ?? 0, visibility: positions[hint.id] ? 'visible' : 'hidden' }}>{hint.label}</kbd>)}
  </div>, document.body);
}

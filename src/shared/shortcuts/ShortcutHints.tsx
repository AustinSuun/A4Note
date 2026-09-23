import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { canDispatchShortcut, resolveShortcuts } from '../../core/shortcuts';
import { elementIsVisible, eventTargetIsEditable, modalIsOpen } from './dispatcher';
import { layoutShortcutHints, type HintPosition, type HintRect } from './hintLayout';
import { hintKeycaps } from './hintKeycaps';
import type { ShortcutStore } from './store';

type Hint = { id: string; keys: string[]; compactKeys: string[]; title: string; group: string; enabled: boolean; anchor?: Element };
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
        if (seen.has(command.id) || command.showInHints?.(context) === false || (!bindings.length && !command.fixedGesture)) return [];
        seen.add(command.id);
        // One primary effective binding keeps the overlay compact. All alternatives
        // remain in the existing button tooltip, aria-keyshortcuts and editor.
        const node = nodes.find(node => node.dataset.shortcutId === command.id);
        return [{ id: command.id, keys: command.fixedGesture?.keys ?? hintKeycaps(bindings[0]), compactKeys: command.fixedGesture?.compactKeys ?? hintKeycaps(bindings[0], true), title: command.title.replace(/^笔记工作台：/, ''), group: command.group, enabled: canDispatchShortcut(command, context), anchor: node ? sceneTileIcon(node) ?? node : undefined }];
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
    const elements = [...root.current.querySelectorAll<HTMLElement>('[data-measure-id]')];
    const compactElements = [...root.current.querySelectorAll<HTMLElement>('[data-compact-measure-id]')];
    const controls = [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="button"], [role="menuitemradio"], #a4note-live-dev-badge')].filter(visibleControl).flatMap(controlRects);
    // Protect whole popup surfaces, not just their buttons. A higher stacking
    // layer can otherwise hide a keycap in apparently empty inter-button space.
    controls.push(...[...document.querySelectorAll<HTMLElement>('[role="menu"], [role="listbox"], [role="tooltip"], [role="dialog"], [popover], [data-shortcut-obstacle], .annotation-inline-actions, .annotation-color-palette')].filter(elementIsVisible).map(rectOf));
    const measureAndPlace = (compact: boolean) => {
      const layer = root.current!;
      layer.dataset.floatingDensity = compact ? 'compact' : 'regular';
      // Reset before measuring percentage-constrained keys; never feed a stale
      // shrunken column back into itself. Long chords wrap without losing keys.
      const cap = compact ? 128 : 144;
      layer.style.setProperty('--shortcut-key-column', `${cap}px`);
      const measurements = hints.map(hint => {
        const node = elements.find(element => element.dataset.measureId === hint.id)!;
        const rect = node.getBoundingClientRect();
        const compact = compactElements.find(element => element.dataset.compactMeasureId === hint.id)!;
        const keys = compact.querySelector('.shortcut-hint-keys')!.getBoundingClientRect();
        return { id: hint.id, width: Math.ceil(keys.width), height: Math.ceil(keys.height), floatingWidth: Math.ceil(rect.width), floatingHeight: Math.ceil(rect.height), group: hint.group, beside: hint.anchor?.tagName.toLowerCase() === 'svg', anchor: hint.anchor ? rectOf(hint.anchor) : undefined };
      });
      return layoutShortcutHints(measurements, { left: 8, top: 8, right: innerWidth - 8, bottom: innerHeight - 8 }, controls);
    };
    let next = measureAndPlace(false);
    // Keep large dock keycaps in every viewport. Compact only the free-floating
    // action rows if the measured large layout cannot display all commands.
    if (Object.keys(next).length < hints.length) next = measureAndPlace(true);
    setPositions(next);
  }, [hints, store, store.hintVisible]);

  const keys = (hint: Hint, compact = false) => <span className="shortcut-hint-keys">{(compact ? hint.compactKeys : hint.keys).map((key, i) => <span className="shortcut-hint-key-part" key={i}>{i > 0 && <span className="shortcut-hint-plus">+</span>}<kbd>{key}</kbd></span>)}</span>;
  return createPortal(<div ref={root} className={`shortcut-hints ${store.hintVisible ? 'is-visible' : ''}`} aria-hidden="true">
    {hints.map(hint => <span key={hint.id} data-hint-id={hint.id} data-hint-placement={positions[hint.id]?.placement}
      className={`shortcut-key-hint ${positions[hint.id]?.placement === 'floating' ? 'shortcut-floating-hint' : ''} ${hint.enabled ? '' : 'is-disabled'}`}
      style={{ left: positions[hint.id]?.left ?? 0, top: positions[hint.id]?.top ?? 0, visibility: positions[hint.id] ? 'visible' : 'hidden' }}>{keys(hint, positions[hint.id]?.placement === 'adjacent')}{positions[hint.id]?.placement === 'floating' && <span className="shortcut-hint-label">{hint.title}</span>}</span>)}
    <div className="shortcut-hint-measures">{hints.map(hint => <span key={hint.id} data-measure-id={hint.id} className="shortcut-floating-hint">{keys(hint)}<span className="shortcut-hint-label">{hint.title}</span></span>)}{hints.map(hint => <span key={`compact-${hint.id}`} data-compact-measure-id={hint.id}>{keys(hint, true)}</span>)}</div>
  </div>, document.body);
}

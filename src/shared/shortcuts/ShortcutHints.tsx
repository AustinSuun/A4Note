import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { canDispatchShortcut, formatBinding, resolveShortcuts } from '../../core/shortcuts';
import { elementIsVisible, eventTargetIsEditable, modalIsOpen } from './dispatcher';
import type { ShortcutStore } from './store';

type Hint = { id: string; title: string; group: string; label: string; enabled: boolean; anchor?: { left: number; top: number } };
export function ShortcutHints({ store }: { store: ShortcutStore }) {
  const revision = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const [hints, setHints] = useState<Hint[]>([]);
  useEffect(() => {
    if (!store.hintVisible) return;
    const measure = () => {
      const context = { ...store.context, editable: eventTargetIsEditable(document.activeElement), modalOpen: store.context.modalOpen || modalIsOpen(document) };
      const nodes = [...document.querySelectorAll<HTMLElement>('[data-shortcut-id]')].filter(node => {
        if (!elementIsVisible(node)) return false;
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === node || Boolean(hit && node.contains(hit));
      });
      const seen = new Set<string>();
      const occupied: { left: number; top: number; right: number; bottom: number }[] = [];
      const panelLeft = innerWidth - Math.min(410, innerWidth - 24) - 12;
      const canvas = document.createElement('canvas').getContext('2d');
      if (canvas) canvas.font = '12px sans-serif';
      setHints(resolveShortcuts(store.commands(), store.overrides, context).filter(({ command }) => {
        if (seen.has(command.id)) return false; seen.add(command.id); return true;
      }).map(({ command, bindings }) => {
        const node = nodes.find((n) => n.dataset.shortcutId === command.id);
        const rect = node?.getBoundingClientRect();
        const within = rect && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
        const label = bindings.map(formatBinding).join(' / ') || '未绑定';
        const enabled = canDispatchShortcut(command, context);
        const width = Math.min(156, (canvas?.measureText(label + (enabled ? '' : ' · 不可用')).width ?? label.length * 8) + 16);
        let anchor: Hint['anchor'];
        if (within) {
          const left = Math.max(8, Math.min(innerWidth - width - 8, rect.left));
          // Keep badges next to their control, never on top of another badge or the
          // right-hand fallback panel. Crowded controls join the labelled panel.
          for (const offset of (rect.top > 64 ? [-30, -58, 2, 30] : [2, 30])) {
            const top = Math.max(8, rect.bottom + offset);
            const box = { left, top, right: left + width, bottom: top + 26 };
            if (box.right >= panelLeft - 8 || box.bottom > innerHeight - 8) continue;
            if (occupied.some(other => box.left < other.right + 4 && box.right + 4 > other.left && box.top < other.bottom + 2 && box.bottom + 2 > other.top)) continue;
            occupied.push(box); anchor = { left, top }; break;
          }
        }
        return { id: command.id, title: command.title, group: command.group, label, enabled, anchor };
      }));
    };
    measure(); window.addEventListener('resize', measure); window.addEventListener('scroll', measure, true); document.addEventListener('focusin', measure);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); document.removeEventListener('focusin', measure); };
  }, [store, revision]);
  const unanchored = hints.filter((h) => !h.anchor);
  return createPortal(<div className={`shortcut-hints ${store.hintVisible ? 'is-visible' : ''}`} aria-hidden="true">
    {hints.filter((h) => h.anchor).map((h) => <kbd key={h.id} className={`shortcut-anchor-hint ${h.enabled ? '' : 'is-disabled'}`} style={h.anchor}>{h.label}{!h.enabled && ' · 不可用'}</kbd>)}
    {unanchored.length > 0 && <aside className="shortcut-hint-panel"><strong>当前快捷键</strong><small>松开 Ctrl 隐藏 · 灰色项当前不可用</small>
      {[...new Set(unanchored.map((h) => h.group))].map((group) => <section key={group}><h3>{group}</h3>{unanchored.filter((h) => h.group === group).map((h) => <div key={h.id} className={h.enabled ? '' : 'is-disabled'}><span>{h.title}</span><kbd>{h.label}</kbd></div>)}</section>)}
    </aside>}
  </div>, document.body);
}

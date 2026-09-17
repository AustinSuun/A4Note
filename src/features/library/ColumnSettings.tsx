import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Columns3 } from 'lucide-react';
import './column-settings.css';

type ColumnOption = { id: string; label: string; visible: boolean; fixed?: boolean };
export function ColumnSettings({ columns, disabled = false, onChange }: {
  columns: ColumnOption[];
  disabled?: boolean;
  onChange: (id: string, visible: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !panel.current) return;
      const button = trigger.current.getBoundingClientRect(), box = panel.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(button.right - box.width, window.innerWidth - box.width - 8));
      const top = Math.max(8, Math.min(button.bottom + box.height + 12 <= window.innerHeight ? button.bottom + 4 : button.top - box.height - 4, window.innerHeight - box.height - 8));
      setPosition(current => current.left === left && current.top === top ? current : { left, top });
    };
    place();
    panel.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    const outside = (event: Event) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', outside, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="column-settings-trigger" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(value => !value)}><Columns3 aria-hidden="true" />列设置</button>
    {open && createPortal(<div ref={panel} id={id} className="column-settings-panel" style={position} role="group" aria-label="选择展示的列"
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true }); } }}
      onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) setOpen(false); }}>
      {columns.map(column => <label key={column.id} className={column.fixed ? 'fixed' : undefined}>
        <input type="checkbox" checked={column.visible} disabled={disabled || column.fixed}
          onChange={event => onChange(column.id, event.target.checked)} />
        <span>{column.label}</span>{column.fixed && <small>固定</small>}
      </label>)}
    </div>, document.body)}
  </>;
}

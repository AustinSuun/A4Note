import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
const languages = [
  { value: 'text', label: '纯文本' }, { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' }, { value: 'typescript', label: 'TypeScript' },
  { value: 'json', label: 'JSON' }, { value: 'bash', label: 'Bash' },
  { value: 'sql', label: 'SQL' }, { value: 'rust', label: 'Rust' }, { value: 'cpp', label: 'C++' },
];
export function DockCodeLanguagePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = Math.max(0, languages.findIndex(item => item.value === value));
  const [active, setActive] = useState(selected);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: '', time: 0 });
  const id = useId();
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const choose = (index: number) => { onChange(languages[index].value); setOpen(false); };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : event.key === 'End' ? languages.length - 1 : !open ? selected : Math.max(0, Math.min(languages.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))));
      setOpen(true); return;
    }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (open) choose(active); else { setActive(selected); setOpen(true); } return; }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const text = (now - typeahead.current.time < 700 ? typeahead.current.text : '') + event.key.toLowerCase();
      typeahead.current = { text, time: now };
      const index = languages.findIndex(item => item.value.startsWith(text) || item.label.toLowerCase().startsWith(text));
      if (index >= 0) { event.preventDefault(); setActive(index); setOpen(true); }
    }
  };
  return <div ref={root} className="dock-code-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <button type="button" className="dock-code-trigger" data-insert-autofocus="" role="combobox" aria-label="代码块语言"
      aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-activedescendant={open ? `${id}-${active}` : undefined}
      onKeyDown={keyDown} onClick={() => { setActive(selected); setOpen(n => !n); }}>
      <span>{languages[selected].label}</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && <div ref={list} id={id} role="listbox" aria-label="代码块语言选项" className="dock-code-list">
      {languages.map((item, index) => <div key={item.value} id={`${id}-${index}`} role="option" aria-selected={index === selected}
        data-index={index} className={`dock-code-option${index === active ? ' is-active' : ''}`}
        onPointerMove={() => setActive(index)} onPointerDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span>{item.label}</span><span className="dock-code-check" aria-hidden="true">{index === selected ? '✓' : ''}</span>
      </div>)}
    </div>}
  </div>;
}

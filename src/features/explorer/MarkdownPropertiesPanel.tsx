// Shared "笔记属性" editor. Lifted verbatim from MarkdownResourceTab so the
// reader note (sidebar / floating / writing forms) and standalone Markdown files
// present the same property types, picker, menu, keyboard and drag-sort behaviour
// against one frontmatter model (task 3eabf1ac). Only the storage of the
// properties differs between hosts: they hand in the parsed properties and
// receive the next map; serialising into YAML stays in core/markdownDocument.
import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, CheckSquare, ChevronRight, List, Pencil, Plus, Tag, Tags, Trash2, UserRound, X } from 'lucide-react';
import type { DocumentProperties, PropertyValue } from '../../core/markdownDocument';

export type PropertyType = 'text' | 'number' | 'boolean' | 'list' | 'date';
export type PropertyDefinition = { key: string; label: string; type: PropertyType; defaultValue: PropertyValue; description: string };
type PropertyDropTarget = { index: number };
type PropertyPointerDrag = {
  key: string;
  pointerId: number;
  startY: number;
  dragging: boolean;
  sourceLeft: number;
  sourceWidth: number;
  sourceHeight: number;
  grabOffsetY: number;
};
type PropertyDragPreview = { key: string; label: string; type: PropertyType; value: string; left: number; top: number; width: number; height: number };

export const commonProperties: PropertyDefinition[] = [
  { key: 'date', label: '日期', type: 'date', defaultValue: '', description: '记录创建或更新日期' },
  { key: 'author', label: '作者', type: 'list', defaultValue: [], description: '记录一个或多个作者、贡献者' },
  { key: 'tags', label: '标签', type: 'list', defaultValue: [], description: '用标签整理和筛选笔记' },
  { key: 'draft', label: '草稿', type: 'boolean', defaultValue: true, description: '标记这篇笔记是否仍在草稿阶段' },
  { key: 'summary', label: '摘要', type: 'text', defaultValue: '', description: '用一句话概括笔记内容' },
  { key: 'aliases', label: '别名', type: 'list', defaultValue: [], description: '为笔记添加其他检索名称' },
  { key: 'cssclasses', label: '样式类', type: 'list', defaultValue: [], description: '为主题或插件提供样式类名' },
];

export const propertyTypeLabels: Record<PropertyType, string> = {
  text: '文本',
  number: '数字',
  boolean: '复选框',
  list: '列表',
  date: '日期',
};

export function propertyTypeFor(key: string, value: PropertyValue): PropertyType {
  const common = commonProperties.find((property) => property.key === key.trim().toLowerCase());
  if (common) return common.type;
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  // Frontmatter commonly uses either a date-only value or localized keys.
  // Treat both forms as dates so they receive the calendar editor instead of
  // falling through to the generic text property (pencil) editor.
  if (/^\d{4}[-/]\d{2}[-/]\d{2}(?:$|[T\s])/.test(String(value).trim())
    || /(date|time|created|updated|due|deadline|日期|时间|创建|更新|截止|到期)/i.test(key)) return 'date';
  return 'text';
}

export function propertyLabel(key: string) {
  switch (key.trim().toLowerCase()) {
    case 'date': return '\u65e5\u671f';
    case 'author': return '\u4f5c\u8005';
    case 'tags': return '\u6807\u7b7e';
    case 'draft': return '\u8349\u7a3f';
    case 'summary': return '\u6458\u8981';
    default: return key;
  }
}

export function propertyPreviewValue(value: PropertyValue) {
  if (Array.isArray(value)) return value.length ? value.join('\u3001') : '\u672a\u8bbe\u7f6e';
  if (typeof value === 'boolean') return value ? '\u662f' : '\u5426';
  return String(value ?? '').trim() || '\u672a\u8bbe\u7f6e';
}

export function propertyIcon(key: string, type?: PropertyType) {
  switch (key.trim().toLowerCase()) {
    case 'date': return <CalendarDays size={16} aria-hidden="true" />;
    case 'author': return <UserRound size={16} aria-hidden="true" />;
    case 'tags': return <Tag size={16} aria-hidden="true" />;
    case 'draft': return <CheckSquare size={16} aria-hidden="true" />;
    default:
      if (type === 'date') return <CalendarDays size={16} aria-hidden="true" />;
      if (type === 'boolean') return <CheckSquare size={16} aria-hidden="true" />;
      if (type === 'list') return <List size={16} aria-hidden="true" />;
      if (type === 'text') return <Pencil size={16} aria-hidden="true" />;
      return <Tags size={16} aria-hidden="true" />;
  }
}

function dateTimeValue(value: string) {
  const match = value.match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4] ?? '00'}:${match[5] ?? '00'}` : '';
}

function dateDisplayValue(value: string) {
  const match = value.trim().match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
  if (!match) return '';
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return match[4] && match[5] ? `${date} ${match[4]}:${match[5]}` : date;
}

function DatePropertyEditor({ value, onChange }: { value: PropertyValue; onChange: (value: string) => void }) {
  const nativeInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(() => dateDisplayValue(String(value ?? '')));
  useEffect(() => {
    const next = dateDisplayValue(String(value ?? ''));
    if (next && next !== draft) setDraft(next);
    if (!String(value ?? '').trim() && draft) setDraft('');
    // The draft intentionally remains local while the user types an incomplete date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = () => {
    const next = draft.trim();
    if (/^\d{4}[-/]\d{2}[-/]\d{2}(?:(?:\s|T)\d{2}:\d{2})?$/.test(next)) {
      onChange(next.replace(/\//g, '-'));
      return;
    }
    setDraft(dateDisplayValue(String(value ?? '')));
  };

  return <div className="markdown-property-date-editor">
    <button type="button" className="markdown-property-date-picker" onClick={() => { const input = nativeInputRef.current; if (!input) return; input.focus(); input.showPicker?.(); }} aria-label="选择日期和时间"><CalendarDays size={15} aria-hidden="true" /></button>
    <input className="markdown-property-date" type="text" inputMode="numeric" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} aria-label="日期和时间" placeholder="YYYY-MM-DD" />
    <input ref={nativeInputRef} className="markdown-property-date-native" type="datetime-local" value={dateTimeValue(String(value ?? ''))} onChange={(event) => { const next = event.target.value; setDraft(dateDisplayValue(next)); onChange(next); }} tabIndex={-1} aria-hidden="true" />
  </div>;
}

function ArrayPropertyEditor({ value, onChange, placeholder, suggestions = [] }: { value: string[]; onChange: (value: string[]) => void; placeholder: string; suggestions?: string[] }) {
  const [draft, setDraft] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const add = () => {
    const next = draft.trim();
    if (!next || value.includes(next)) return;
    onChange([...value, next]);
    setDraft('');
  };
  const visibleSuggestions = suggestions.filter((item) => !value.includes(item) && (!draft.trim() || item.toLowerCase().includes(draft.trim().toLowerCase())));
  return <div className="markdown-property-array-editor"><div className="markdown-property-chips">{value.map((item) => <span className="markdown-property-chip" key={item}>{item}<button type="button" onClick={() => onChange(value.filter((candidate) => candidate !== item))} aria-label={`删除 ${item}`}>×</button></span>)}</div><div className="markdown-property-value-input"><input value={draft} onChange={(event) => { setDraft(event.target.value); setSuggestionsOpen(true); }} onFocus={() => setSuggestionsOpen(true)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(); } }} onBlur={() => { add(); window.setTimeout(() => setSuggestionsOpen(false), 120); }} placeholder={placeholder} />{suggestionsOpen && visibleSuggestions.length > 0 && <div className="markdown-property-value-suggestions" role="listbox">{visibleSuggestions.map((item) => <button type="button" key={item} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange([...value, item]); setDraft(''); setSuggestionsOpen(false); }} role="option">{item}</button>)}</div>}</div></div>;
}


/** Read-mode chips; the same rendering the Markdown tab shows above its preview. */
export function MarkdownPropertySummary({ properties, ariaLabel = '文档属性' }: { properties: DocumentProperties; ariaLabel?: string }) {
  const entries = Object.entries(properties);
  if (!entries.length) return null;
  return <div className="markdown-property-summary" aria-label={ariaLabel}>{entries.map(([key, value]) => <span key={key} className="markdown-property-summary-item"><span className="markdown-property-summary-label">{propertyLabel(key)}</span><strong>{Array.isArray(value) ? value.join('、') || '未设置' : typeof value === 'boolean' ? (value ? '是' : '否') : value || '未设置'}</strong></span>)}</div>;
}

export interface MarkdownPropertiesPanelProps {
  properties: DocumentProperties;
  /** Receives the next complete map; hosts serialise it and surface their own errors. */
  onChange: (next: DocumentProperties) => void;
  heading?: string;
  subtitle?: string;
  ariaLabel?: string;
  className?: string;
  /** Controlled fold state (the reader keeps it per surface); uncontrolled defaults to expanded. */
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
  defaultVisible?: boolean;
  /** Hosts that must not accept edits (read-only / conflict) disable every control. */
  disabled?: boolean;
  /** Optional slot rendered after the heading text (e.g. a count badge). */
  headingExtra?: ReactNode;
}

export function MarkdownPropertiesPanel({ properties, onChange, heading = '笔记属性', subtitle = '常用属性可直接选择，值会同步到文档 YAML', ariaLabel = '笔记属性', className = '', visible, onVisibleChange, defaultVisible = true, disabled = false, headingExtra }: MarkdownPropertiesPanelProps) {
  const [uncontrolledVisible, setUncontrolledVisible] = useState(defaultVisible);
  const propertiesVisible = visible ?? uncontrolledVisible;
  const setPropertiesVisible = (update: boolean | ((current: boolean) => boolean)) => {
    const next = typeof update === 'function' ? update(propertiesVisible) : update;
    if (visible === undefined) setUncontrolledVisible(next);
    onVisibleChange?.(next);
  };
  const [propertyPickerOpen, setPropertyPickerOpen] = useState(false);
  const [propertyMenuKey, setPropertyMenuKey] = useState<string | null>(null);
  const [propertyPickerSearch, setPropertyPickerSearch] = useState('');
  const [propertyTypes, setPropertyTypes] = useState<Record<string, PropertyType>>({});
  const [dragPropertyKey, setDragPropertyKey] = useState<string | null>(null);
  const [propertyDropTarget, setPropertyDropTarget] = useState<PropertyDropTarget | null>(null);
  const [propertyDragPreview, setPropertyDragPreview] = useState<PropertyDragPreview | null>(null);
  const [recentProperties, setRecentProperties] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('a4note.markdown.recent-properties') ?? '[]') as string[]; } catch { return []; }
  });
  const [recentPropertyValues, setRecentPropertyValues] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('a4note.markdown.recent-property-values') ?? '{}') as Record<string, string[]>; } catch { return {}; }
  });
  const [newPropertyName, setNewPropertyName] = useState('');
  const [newPropertyValue, setNewPropertyValue] = useState('');
  const [newPropertyType, setNewPropertyType] = useState<PropertyType>('text');
  const propertyDragKeyRef = useRef<string | null>(null);
  const propertyDragMovedRef = useRef(false);
  const propertyPointerDragRef = useRef<PropertyPointerDrag | null>(null);
  const propertiesPanelRef = useRef<HTMLElement | null>(null);
  const updateProperties = (nextProperties: DocumentProperties) => {
    if (disabled) return;
    onChange(nextProperties);
    setRecentProperties((current) => {
      const next = [...new Set([...Object.keys(nextProperties), ...current])].slice(0, 8);
      try { localStorage.setItem('a4note.markdown.recent-properties', JSON.stringify(next)); } catch { /* storage is optional */ }
      return next;
    });
    setRecentPropertyValues((current) => {
      const next = { ...current };
      Object.entries(nextProperties).forEach(([key, value]) => {
        const values = Array.isArray(value) ? value : typeof value === 'string' && value.trim() ? [value.trim()] : [];
        if (values.length) next[key] = [...new Set([...(next[key] ?? []), ...values])].slice(-12);
      });
      try { localStorage.setItem('a4note.markdown.recent-property-values', JSON.stringify(next)); } catch { /* storage is optional */ }
      return next;
    });
  };
  const addProperty = () => {
    const key = newPropertyName.trim();
    if (!key || Object.hasOwn(properties, key)) return;
    const value: PropertyValue = newPropertyType === 'number'
      ? Number(newPropertyValue) || 0
      : newPropertyType === 'boolean'
        ? newPropertyValue === 'true'
        : newPropertyType === 'list'
          ? newPropertyValue.split(',').map((item) => item.trim()).filter(Boolean)
          : newPropertyValue.trim();
    updateProperties({ ...properties, [key]: value });
    setPropertyTypes((current) => ({ ...current, [key]: newPropertyType }));
    setNewPropertyName('');
    setNewPropertyValue('');
    setNewPropertyType('text');
    setPropertyPickerOpen(false);
    setPropertyPickerSearch('');
  };

  const addSuggestedProperty = (suggestion: PropertyDefinition) => {
    if (Object.hasOwn(properties, suggestion.key)) return;
    updateProperties({ ...properties, [suggestion.key]: suggestion.defaultValue });
    setPropertyTypes((current) => ({ ...current, [suggestion.key]: suggestion.type }));
    setPropertyPickerOpen(false);
    setPropertyPickerSearch('');
  };

  const removeProperty = (key: string) => {
    const next = { ...properties };
    delete next[key];
    updateProperties(next);
    setPropertyTypes((current) => {
      const updated = { ...current };
      delete updated[key];
      return updated;
    });
    setPropertyMenuKey(null);
  };

  const changePropertyType = (key: string, type: PropertyType) => {
    const current = properties[key];
    const nextValue: PropertyValue = type === 'list'
      ? (Array.isArray(current) ? current : String(current ?? '').split(',').map((item) => item.trim()).filter(Boolean))
      : type === 'boolean'
        ? Boolean(current)
        : type === 'number'
          ? Number(current) || 0
          : type === 'date'
            ? dateTimeValue(String(current ?? ''))
            : String(current ?? '');
    updateProperties({ ...properties, [key]: nextValue });
    setPropertyTypes((existing) => ({ ...existing, [key]: type }));
    setPropertyMenuKey(null);
  };

  const reorderProperty = (sourceKey: string, targetKey: string, position: 'before' | 'after') => {
    if (!sourceKey || sourceKey === targetKey) return;
    const entries = Object.entries(properties);
    const sourceIndex = entries.findIndex(([key]) => key === sourceKey);
    if (sourceIndex < 0) return;
    const [source] = entries.splice(sourceIndex, 1);
    const targetIndex = entries.findIndex(([key]) => key === targetKey);
    if (targetIndex < 0) return;
    entries.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, source);
    updateProperties(Object.fromEntries(entries));
  };

  const endPropertyDrag = () => {
    propertyDragKeyRef.current = null;
    setDragPropertyKey(null);
    setPropertyDropTarget(null);
    setPropertyDragPreview(null);
    // Keep the flag through the pointerup/click sequence so a completed drag
    // does not also open the property menu.
    window.setTimeout(() => { propertyDragMovedRef.current = false; }, 0);
  };

  const propertyInsertionIndexAtY = (clientY: number, sourceKey: string) => {
    const propertiesPanel = propertiesPanelRef.current;
    if (!propertiesPanel) return null;
    const panelBounds = propertiesPanel.getBoundingClientRect();
    if (clientY < panelBounds.top || clientY > panelBounds.bottom) return null;
    const rows = Array.from(propertiesPanel.querySelectorAll<HTMLElement>('.markdown-property-row'))
      .filter((row) => row.dataset.propertyKey !== sourceKey);
    for (let index = 0; index < rows.length; index += 1) {
      const bounds = rows[index].getBoundingClientRect();
      if (clientY < bounds.top + bounds.height / 2) return index;
    }
    return rows.length;
  };

  const updatePropertyDropTargetFromPoint = (clientY: number) => {
    const sourceKey = propertyDragKeyRef.current;
    if (!sourceKey) return;
    const index = propertyInsertionIndexAtY(clientY, sourceKey);
    // Keep the last valid slot while the pointer briefly crosses the panel
    // edge. The single in-flow placeholder therefore never disappears while
    // the user is still dragging.
    if (index === null) return;
    setPropertyDropTarget((current) => current?.index === index ? current : { index });
  };

  const reorderPropertyAtPoint = (sourceKey: string, clientY: number) => {
    const index = propertyInsertionIndexAtY(clientY, sourceKey);
    if (index === null) return;
    const entries = Object.entries(properties);
    const sourceIndex = entries.findIndex(([key]) => key === sourceKey);
    if (sourceIndex < 0) return;
    const [source] = entries.splice(sourceIndex, 1);
    entries.splice(Math.max(0, Math.min(index, entries.length)), 0, source);
    updateProperties(Object.fromEntries(entries));
  };

  const startPropertyPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>, key: string) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const row = event.currentTarget.closest<HTMLElement>('.markdown-property-row');
    const bounds = row?.getBoundingClientRect();
    const sourceLeft = bounds?.left ?? event.currentTarget.getBoundingClientRect().left;
    const sourceTop = bounds?.top ?? event.currentTarget.getBoundingClientRect().top;
    const sourceWidth = bounds?.width ?? 0;
    const sourceHeight = bounds?.height ?? 44;
    propertyPointerDragRef.current = {
      key,
      pointerId: event.pointerId,
      startY: event.clientY,
      dragging: false,
      sourceLeft,
      sourceWidth,
      sourceHeight,
      grabOffsetY: event.clientY - sourceTop,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const pointerDrag = propertyPointerDragRef.current;
      if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
      if (!pointerDrag.dragging) {
        const distance = Math.abs(event.clientY - pointerDrag.startY);
        if (distance < 5) return;
        pointerDrag.dragging = true;
        propertyDragKeyRef.current = pointerDrag.key;
        propertyDragMovedRef.current = true;
        const value = properties[pointerDrag.key];
        const type = propertyTypes[pointerDrag.key] ?? propertyTypeFor(pointerDrag.key, value);
        const sourceIndex = Object.keys(properties).findIndex((key) => key === pointerDrag.key);
        setPropertyDragPreview({
          key: pointerDrag.key,
          label: propertyLabel(pointerDrag.key),
          type,
          value: propertyPreviewValue(value),
          left: pointerDrag.sourceLeft,
          top: event.clientY - pointerDrag.grabOffsetY,
          width: pointerDrag.sourceWidth,
          height: pointerDrag.sourceHeight,
        });
        setDragPropertyKey(pointerDrag.key);
        setPropertyDropTarget({ index: Math.max(0, sourceIndex) });
      }
      event.preventDefault();
      setPropertyDragPreview((current) => current ? { ...current, top: event.clientY - pointerDrag.grabOffsetY } : current);
      updatePropertyDropTargetFromPoint(event.clientY);
    };
    const handlePointerUp = (event: PointerEvent) => {
      const pointerDrag = propertyPointerDragRef.current;
      if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
      if (pointerDrag.dragging) {
        event.preventDefault();
        reorderPropertyAtPoint(pointerDrag.key, event.clientY);
      }
      propertyPointerDragRef.current = null;
      endPropertyDrag();
    };
    const handlePointerCancel = (event: PointerEvent) => {
      const pointerDrag = propertyPointerDragRef.current;
      if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
      propertyPointerDragRef.current = null;
      endPropertyDrag();
    };
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [properties, propertyTypes]);

  useEffect(() => {
    if (!propertyMenuKey && !propertyPickerOpen) return undefined;
    const close = () => {
      setPropertyMenuKey(null);
      setPropertyPickerOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [propertyMenuKey, propertyPickerOpen]);
  const recentSuggestions = recentProperties
    .filter((key) => !Object.hasOwn(properties, key))
    .map((key) => commonProperties.find((suggestion) => suggestion.key === key) ?? { key, label: key, type: 'text' as PropertyType, defaultValue: '' as PropertyValue, description: '最近使用的属性' });
  const propertyQuery = propertyPickerSearch.trim().toLowerCase();
  const matchesPropertyQuery = (suggestion: PropertyDefinition) => !propertyQuery
    || suggestion.label.toLowerCase().includes(propertyQuery)
    || suggestion.key.toLowerCase().includes(propertyQuery)
    || propertyTypeLabels[suggestion.type].includes(propertyPickerSearch.trim());
  const visibleCommonSuggestions = commonProperties.filter(matchesPropertyQuery);
  const visibleRecentSuggestions = recentSuggestions.filter(matchesPropertyQuery);
  const propertyEntries = Object.entries(properties);
  const renderedPropertyEntries = dragPropertyKey
    ? propertyEntries.filter(([key]) => key !== dragPropertyKey)
    : propertyEntries;
  const dragSourceIndex = dragPropertyKey
    ? propertyEntries.findIndex(([key]) => key === dragPropertyKey)
    : -1;
  const dragInsertionIndex = dragPropertyKey
    ? Math.max(0, Math.min(propertyDropTarget?.index ?? Math.max(0, dragSourceIndex), renderedPropertyEntries.length))
    : -1;
  return <><aside ref={propertiesPanelRef} className={'markdown-properties' + (propertiesVisible ? '' : ' is-collapsed') + (className ? ' ' + className : '') + (disabled ? ' is-disabled' : '') + (propertyPickerOpen || propertyMenuKey ? ' is-popover-open' : '')} aria-label={ariaLabel} aria-disabled={disabled || undefined}>
    <div className="markdown-properties-heading"><div><strong>{heading}{headingExtra}</strong><small>{subtitle}</small></div><button type="button" className={propertiesVisible ? 'expanded' : 'collapsed'} onClick={() => setPropertiesVisible((visible) => !visible)} title={propertiesVisible ? "\u6536\u8d77\u5c5e\u6027" : "\u5c55\u5f00\u5c5e\u6027"} aria-label={propertiesVisible ? "\u6536\u8d77\u5c5e\u6027" : "\u5c55\u5f00\u5c5e\u6027"}><ChevronRight size={18} aria-hidden="true" /></button></div>
    {propertiesVisible && <>
    <div className="markdown-property-hint">选择属性后可在右侧直接编辑；数组值用逗号分隔。</div>
    {renderedPropertyEntries.map(([key, value], index) => {
      const type = propertyTypes[key] ?? propertyTypeFor(key, value);
      return <Fragment key={key}>
        {dragPropertyKey && dragInsertionIndex === index && <div className="markdown-property-drop-placeholder" style={{ height: propertyDragPreview?.height ?? 44 }} aria-hidden="true" />}
        <div className="markdown-property-row" data-property-key={key}>
          <button type="button" className="markdown-property-icon" draggable={false} onPointerDown={(event) => startPropertyPointerDrag(event, key)} onClick={(event) => { event.stopPropagation(); if (propertyDragMovedRef.current) { event.preventDefault(); propertyDragMovedRef.current = false; return; } setPropertyPickerOpen(false); setPropertyMenuKey(propertyMenuKey === key ? null : key); }} title={`${propertyLabel(key)}：${propertyTypeLabels[type]}（点击打开菜单，拖动排序）`} aria-label={`${propertyLabel(key)} 属性菜单，拖动以调整位置`}>{propertyIcon(key, type)}</button>
          <input className="markdown-property-name" value={propertyLabel(key)} onChange={(event) => { const next = event.target.value.trim(); if (!next || (next !== key && Object.hasOwn(properties, next))) return; const updated = { ...properties }; delete updated[key]; updated[next] = value; updateProperties(updated); setPropertyTypes((current) => { const nextTypes = { ...current, [next]: type }; delete nextTypes[key]; return nextTypes; }); }} aria-label="属性名称" />
          {type === 'boolean' ? <input className="markdown-property-checkbox" type="checkbox" checked={Boolean(value)} onChange={(event) => updateProperties({ ...properties, [key]: event.target.checked })} /> : type === 'date' ? <DatePropertyEditor value={value} onChange={(next) => updateProperties({ ...properties, [key]: next })} /> : type === 'number' ? <input type="number" step="any" value={typeof value === 'number' ? value : Number(value) || 0} onChange={(event) => updateProperties({ ...properties, [key]: Number(event.target.value) || 0 })} /> : type === 'list' ? <ArrayPropertyEditor value={Array.isArray(value) ? value : String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean)} onChange={(next) => updateProperties({ ...properties, [key]: next })} placeholder={key.toLowerCase() === 'tags' ? '添加标签' : '添加值'} suggestions={recentPropertyValues[key]} /> : <><input type="text" list={recentPropertyValues[key]?.length ? `property-text-options-${key}` : undefined} value={String(value)} placeholder="输入内容" onChange={(event) => updateProperties({ ...properties, [key]: event.target.value })} />{recentPropertyValues[key]?.length ? <datalist id={`property-text-options-${key}`}>{recentPropertyValues[key].map((item) => <option key={item} value={item} />)}</datalist> : null}</>}
          {propertyMenuKey === key && <div className="markdown-property-menu" onClick={(event) => event.stopPropagation()}>
            <div className="markdown-property-menu-title">属性类型</div>
            {(['text', 'number', 'boolean', 'list', 'date'] as PropertyType[]).map((candidate) => <button type="button" className={candidate === type ? 'selected' : ''} key={candidate} onClick={() => changePropertyType(key, candidate)}><span>{propertyTypeLabels[candidate]}</span>{candidate === type && <Check size={13} aria-hidden="true" />}</button>)}
            <div className="markdown-property-menu-divider" />
            <button type="button" className="danger" onClick={() => removeProperty(key)}><Trash2 size={14} />移除属性</button>
          </div>}
        </div>
      </Fragment>;
    })}
    {dragPropertyKey && dragInsertionIndex === renderedPropertyEntries.length && <div className="markdown-property-drop-placeholder" style={{ height: propertyDragPreview?.height ?? 44 }} aria-hidden="true" />}
    <button type="button" className="markdown-property-suggest-toggle" onClick={(event) => { event.stopPropagation(); setPropertyMenuKey(null); setPropertyPickerOpen((open) => !open); }}><Plus size={15} aria-hidden="true" />添加笔记属性</button>
    {propertyPickerOpen && <div className="markdown-property-suggestions" role="dialog" aria-label="添加笔记属性" onClick={(event) => event.stopPropagation()}>
      <div className="markdown-property-picker-head"><strong>添加笔记属性</strong><button type="button" onClick={() => setPropertyPickerOpen(false)} title="关闭" aria-label="关闭"><X size={14} /></button></div>
      <input className="markdown-property-search" value={propertyPickerSearch} onChange={(event) => setPropertyPickerSearch(event.target.value)} placeholder="搜索属性名称或类型" aria-label="搜索属性" />
      {visibleRecentSuggestions.length > 0 && <><div className="markdown-property-suggestions-title">最近使用</div>{visibleRecentSuggestions.map((suggestion) => <button type="button" className="markdown-property-option" key={`recent-${suggestion.key}`} onClick={() => addSuggestedProperty(suggestion)}><span className="markdown-property-option-icon">{propertyIcon(suggestion.key, suggestion.type)}</span><span className="markdown-property-option-copy"><strong>{suggestion.label}</strong><small>{suggestion.description}</small></span><em>{propertyTypeLabels[suggestion.type]}</em></button>)}</>}
      {visibleCommonSuggestions.length > 0 && <><div className="markdown-property-suggestions-title">常用属性</div>{visibleCommonSuggestions.map((suggestion) => <button type="button" className="markdown-property-option" key={suggestion.key} disabled={Object.hasOwn(properties, suggestion.key)} onClick={() => addSuggestedProperty(suggestion)}><span className="markdown-property-option-icon">{propertyIcon(suggestion.key, suggestion.type)}</span><span className="markdown-property-option-copy"><strong>{suggestion.label}</strong><small>{suggestion.description}</small></span><em>{Object.hasOwn(properties, suggestion.key) ? '已添加' : propertyTypeLabels[suggestion.type]}</em></button>)}</>}
      {!visibleRecentSuggestions.length && !visibleCommonSuggestions.length && <div className="markdown-property-empty">没有匹配的预设属性，可以在下方创建。</div>}
      <div className="markdown-property-custom"><div className="markdown-property-suggestions-title">自定义属性</div><div className="markdown-property-custom-form" onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addProperty(); } }}><input value={newPropertyName} onChange={(event) => setNewPropertyName(event.target.value)} placeholder="属性名称" aria-label="自定义属性名称" /><select value={newPropertyType} onChange={(event) => setNewPropertyType(event.target.value as PropertyType)} aria-label="属性类型">{(['text', 'number', 'boolean', 'list', 'date'] as PropertyType[]).map((type) => <option key={type} value={type}>{propertyTypeLabels[type]}</option>)}</select>{newPropertyType === 'boolean' ? <select value={newPropertyValue} onChange={(event) => setNewPropertyValue(event.target.value)} aria-label="自定义属性初始值"><option value="">否</option><option value="true">是</option></select> : <input type={newPropertyType === 'date' ? 'datetime-local' : newPropertyType === 'number' ? 'number' : 'text'} value={newPropertyValue} onChange={(event) => setNewPropertyValue(event.target.value)} placeholder={newPropertyType === 'list' ? '值用逗号分隔（可留空）' : '初始值（可留空）'} aria-label="自定义属性初始值" />}<button type="button" disabled={!newPropertyName.trim() || Object.hasOwn(properties, newPropertyName.trim())} onClick={addProperty}><Plus size={14} />添加</button></div></div>
    </div>}
    {propertyPickerOpen && <div className="markdown-property-choice-list" role="dialog" aria-label="可添加属性" onClick={(event) => event.stopPropagation()}>
      <div className="markdown-property-picker-head"><strong>可添加属性</strong><button type="button" onClick={() => setPropertyPickerOpen(false)} title="关闭" aria-label="关闭"><X size={14} /></button></div>
      {commonProperties.map((suggestion) => <button type="button" className="markdown-property-option" key={`choice-${suggestion.key}`} disabled={Object.hasOwn(properties, suggestion.key)} onClick={() => addSuggestedProperty(suggestion)}><span className="markdown-property-option-icon">{propertyIcon(suggestion.key, suggestion.type)}</span><span className="markdown-property-option-copy"><strong>{suggestion.label}</strong><small>{suggestion.description}</small></span><em>{Object.hasOwn(properties, suggestion.key) ? '已添加' : propertyTypeLabels[suggestion.type]}</em></button>)}
    </div>}
    </>}
  </aside>
    {propertyDragPreview && createPortal(<div className="markdown-property-drag-preview" style={{ left: propertyDragPreview.left, top: propertyDragPreview.top, width: propertyDragPreview.width, height: propertyDragPreview.height }} aria-hidden="true">
      <span className="markdown-property-drag-preview-icon">{propertyIcon(propertyDragPreview.key, propertyDragPreview.type)}</span>
      <span className="markdown-property-drag-preview-name">{propertyDragPreview.label}</span>
      <span className="markdown-property-drag-preview-value">{propertyDragPreview.value}</span>
    </div>, document.body)}
  </>;
}

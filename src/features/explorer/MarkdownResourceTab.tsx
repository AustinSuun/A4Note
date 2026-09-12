import { Bold, BookOpen, CalendarDays, Check, CheckSquare, ChevronDown, ChevronRight, Clipboard, ClipboardPaste, Code2, Eraser, ExternalLink, Heading1, Heading2, Heading3, Heading4, Heading5, Heading6, Highlighter, ImagePlus, Italic, Link as LinkIcon, List, ListChecks, ListOrdered, ListTree, LoaderCircle, Minus, Pencil, Pilcrow, Plus, Quote, Scissors, Sigma, Strikethrough, Table2, Tag, Tags, Trash2, UserRound, X } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { isTauriRuntime, openExternalUrl, readFileBytes, type RenamedTextFile } from '../../platform/projects';
import { zh } from '../../ui/zh';
import { MarkdownCallout, MarkdownCodeBlock, MarkdownFigure, MarkdownFootnoteBackref, MarkdownFootnoteRef, MarkdownFootnotesSection, MarkdownTable, remarkAsterInline, wikiLinkProtocol, wikiLinkTarget } from '../../shared/markdown';
import { MarkdownLivePreviewEditor, type MarkdownLivePreviewEditorHandle } from './MarkdownLivePreviewEditor';
import { MarkdownDocumentTitle } from './MarkdownDocumentTitle';
import { useTextDocument } from './useTextDocument';
import { splitFrontmatter, titleFromBody, stripDocumentTitle, replaceMarkdownBody, replaceMarkdownLiveBody, updateMarkdownProperties, type PropertyValue, type DocumentProperties } from '../../core/markdownDocument';

export interface MarkdownResourceTabProps {
  path: string;
  name: string;
  onRenamed?: (file: RenamedTextFile) => void;
  /** Opens a `[[note]]` link. Without it, wiki links render as inert text. */
  onOpenWikiLink?: (target: string) => void | Promise<void>;
}

type PropertyType = 'text' | 'number' | 'boolean' | 'list' | 'date';
type PropertyDefinition = { key: string; label: string; type: PropertyType; defaultValue: PropertyValue; description: string };
type MarkdownEditorChangeContext = { previousMarkdown: string; sourceMode: boolean; sessionId: number };
type MarkdownHeading = { id: string; level: number; text: string; lineNumber: number; sourceOffset: number };
type MarkdownTocHeading = MarkdownHeading & {
  hasChildHeadings: boolean;
  hasSectionContent: boolean;
  hasCollapsibleContent: boolean;
  /** Index of the first following heading that closes this section. */
  sectionEndIndex: number;
};
type EditorContextMenuState = {
  x: number;
  y: number;
  submenuSide: 'right' | 'left';
  verticalSide: 'top' | 'bottom';
};
type MarkdownTocGuideRail = { id: string; level: number; left: number; top: number; height: number; startIndex: number; endIndex: number };
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

/**
 * Return an element's coordinates in the scroll content coordinate system of
 * an ancestor. Adding the ancestor's scroll offset makes the result stable
 * while the TOC is scrolled, while DOMRects retain sub-pixel precision so the
 * guide and its Chevron share an exact center instead of drifting by a pixel.
 */
function offsetWithin(element: HTMLElement, ancestor: HTMLElement) {
  if (!ancestor.contains(element)) return null;
  const elementRect = element.getBoundingClientRect();
  const ancestorRect = ancestor.getBoundingClientRect();
  return {
    top: elementRect.top - ancestorRect.top + ancestor.scrollTop,
    left: elementRect.left - ancestorRect.left + ancestor.scrollLeft,
    width: elementRect.width,
    height: elementRect.height,
  };
}

/** Measure an element against an overlay that moves with the same scrolling
 * content. Their rect difference is already in the overlay's content space. */
function offsetWithinLayer(element: HTMLElement, layer: HTMLElement, scrollAncestor: HTMLElement) {
  if (!scrollAncestor.contains(element)) return null;
  const elementRect = element.getBoundingClientRect();
  const layerRect = layer.getBoundingClientRect();
  return {
    top: elementRect.top - layerRect.top,
    left: elementRect.left - layerRect.left,
    width: elementRect.width,
    height: elementRect.height,
  };
}

const commonProperties: PropertyDefinition[] = [
  { key: 'date', label: '日期', type: 'date', defaultValue: '', description: '记录创建或更新日期' },
  { key: 'author', label: '作者', type: 'list', defaultValue: [], description: '记录一个或多个作者、贡献者' },
  { key: 'tags', label: '标签', type: 'list', defaultValue: [], description: '用标签整理和筛选笔记' },
  { key: 'draft', label: '草稿', type: 'boolean', defaultValue: true, description: '标记这篇笔记是否仍在草稿阶段' },
  { key: 'summary', label: '摘要', type: 'text', defaultValue: '', description: '用一句话概括笔记内容' },
  { key: 'aliases', label: '别名', type: 'list', defaultValue: [], description: '为笔记添加其他检索名称' },
  { key: 'cssclasses', label: '样式类', type: 'list', defaultValue: [], description: '为主题或插件提供样式类名' },
];

const propertyTypeLabels: Record<PropertyType, string> = {
  text: '文本',
  number: '数字',
  boolean: '复选框',
  list: '列表',
  date: '日期',
};

function propertyTypeFor(key: string, value: PropertyValue): PropertyType {
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

function safeMarkdownUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed || /^(javascript|vbscript|data:text\/html):/i.test(trimmed)) return '';
  return trimmed;
}

function joinDocumentPath(documentPath: string, source: string) {
  if (/^(?:[a-z]+:|[\\/])/i.test(source)) return source;
  const base = documentPath.replace(/[\\/][^\\/]*$/, '');
  return `${base}\\${source.replace(/^\.\//, '').replace(/\//g, '\\')}`;
}

function mimeForPath(path: string) {
  const extension = path.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream';
}

function bytesToDataUrl(bytes: number[], mime: string) {
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 0x8000) chunks.push(String.fromCharCode(...bytes.slice(index, index + 0x8000)));
  return `data:${mime};base64,${btoa(chunks.join(''))}`;
}

function MarkdownImage({ src, alt, title, documentPath }: { src?: string; alt?: string; title?: string; documentPath: string }) {
  const [resolved, setResolved] = useState(src ?? '');
  useEffect(() => {
    let cancelled = false;
    const source = safeMarkdownUrl(src ?? '');
    setResolved(source);
    if (!source || /^(?:data:|https?:|blob:)/i.test(source) || !isTauriRuntime()) return undefined;
    const path = joinDocumentPath(documentPath, source);
    void readFileBytes(path).then((bytes) => {
      if (!cancelled) setResolved(bytesToDataUrl(bytes, mimeForPath(path)));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [documentPath, src]);
  if (!resolved) return null;
  return <MarkdownFigure src={resolved} alt={alt} title={title} />;
}

function normalizeEmbeddedMarkdown(markdown: string) {
  return markdown
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, (tag, src: string) => {
      const alt = tag.match(/alt=["']([^"']*)["']/i)?.[1] ?? '';
      return `![${alt}](${src})`;
    })
    .replace(/==([^=\n]+)==/g, (_, value: string) => `[${value}](a4note-highlight:${encodeURIComponent(value)})`);
}

function headingText(source: string) {
  return source
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\\([\\`*_{}\[\]()#+.!-])/g, '$1')
    .trim();
}

/** Extract only ATX headings outside fenced code blocks for the note outline. */
function extractMarkdownHeadings(markdown: string, startIndex = 0): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const lines = markdown.split(/\r?\n/);
  let offset = 0;
  let fence: { character: string; length: number } | null = null;

  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.character && fenceMatch[1].length >= fence.length) fence = null;
      offset += line.length + 1;
      return;
    }
    if (fenceMatch) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
      offset += line.length + 1;
      return;
    }
    const match = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/);
    if (match) {
      const text = headingText(match[2]);
      if (text) headings.push({
        id: `markdown-heading-${startIndex + headings.length}`,
        level: match[1].length,
        text,
        lineNumber: index + 1,
        sourceOffset: offset,
      });
    }
    offset += line.length + 1;
  });
  return headings;
}

function propertyLabel(key: string) {
  switch (key.trim().toLowerCase()) {
    case 'date': return '\u65e5\u671f';
    case 'author': return '\u4f5c\u8005';
    case 'tags': return '\u6807\u7b7e';
    case 'draft': return '\u8349\u7a3f';
    case 'summary': return '\u6458\u8981';
    default: return key;
  }
}

function propertyPreviewValue(value: PropertyValue) {
  if (Array.isArray(value)) return value.length ? value.join('\u3001') : '\u672a\u8bbe\u7f6e';
  if (typeof value === 'boolean') return value ? '\u662f' : '\u5426';
  return String(value ?? '').trim() || '\u672a\u8bbe\u7f6e';
}

function propertyIcon(key: string, type?: PropertyType) {
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

export function MarkdownResourceTab({ path, name, onRenamed, onOpenWikiLink }: MarkdownResourceTabProps) {
  const displayTitle = name.replace(/\.(?:md|markdown|mdx)$/i, '') || '\u672a\u547d\u540d\u6587\u6863';
  const { documentId, content, setContent, loading, error, saveState, saveError, save: saveImmediately, reload } = useTextDocument(path);
  const [operationError, setOperationError] = useState('');
  const openWikiLink = (target: string) => {
    setOperationError('');
    if (!onOpenWikiLink) { setOperationError('当前入口未连接项目双链导航。'); return; }
    void Promise.resolve().then(() => onOpenWikiLink(target)).catch((error) => setOperationError(String(error)));
  };
  const [mode, setMode] = useState<'edit' | 'read'>('edit');
  const [editSurface, setEditSurface] = useState<'live' | 'source'>('live');
  const [tocOpen, setTocOpen] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [hoveredHeadingId, setHoveredHeadingId] = useState<string | null>(null);
  const [tocGuideLayout, setTocGuideLayout] = useState<{ contentHeight: number; rails: MarkdownTocGuideRail[] }>({ contentHeight: 0, rails: [] });
  const [propertiesVisible, setPropertiesVisible] = useState(true);
  const [propertyPickerOpen, setPropertyPickerOpen] = useState(false);
  const [propertyMenuKey, setPropertyMenuKey] = useState<string | null>(null);
  const [propertyPickerSearch, setPropertyPickerSearch] = useState('');
  const [propertyTypes, setPropertyTypes] = useState<Record<string, PropertyType>>({});
  const [dragPropertyKey, setDragPropertyKey] = useState<string | null>(null);
  const [propertyDropTarget, setPropertyDropTarget] = useState<PropertyDropTarget | null>(null);
  const [propertyDragPreview, setPropertyDragPreview] = useState<PropertyDragPreview | null>(null);
  const [editorContextMenu, setEditorContextMenu] = useState<EditorContextMenuState | null>(null);
  const [editorMenuSection, setEditorMenuSection] = useState<'format' | 'paragraph' | 'insert' | null>(null);
  const [editorHasSelection, setEditorHasSelection] = useState(false);
  const [recentProperties, setRecentProperties] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('a4note.markdown.recent-properties') ?? '[]') as string[]; } catch { return []; }
  });
  const [recentPropertyValues, setRecentPropertyValues] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('a4note.markdown.recent-property-values') ?? '{}') as Record<string, string[]>; } catch { return {}; }
  });
  const [newPropertyName, setNewPropertyName] = useState('');
  const [newPropertyValue, setNewPropertyValue] = useState('');
  const [newPropertyType, setNewPropertyType] = useState<PropertyType>('text');
  const liveEditorRef = useRef<MarkdownLivePreviewEditorHandle | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const contentScrollerRef = useRef<HTMLDivElement | null>(null);
  const tocListRef = useRef<HTMLElement | null>(null);
  const tocGuidesRef = useRef<HTMLDivElement | null>(null);
  const tocRowRefs = useRef(new Map<string, HTMLElement>());
  const contentRef = useRef(content);
  const editorSessionCounterRef = useRef(0);
  const activeEditorSessionRef = useRef<{ key: string; id: number }>({ key: '', id: 0 });
  const editorBodyRef = useRef('');
  const propertyDragKeyRef = useRef<string | null>(null);
  const propertyDragMovedRef = useRef(false);
  const propertyPointerDragRef = useRef<PropertyPointerDrag | null>(null);
  const propertiesPanelRef = useRef<HTMLElement | null>(null);
  contentRef.current = content;
  const split = useMemo(() => splitFrontmatter(content), [content]);
  const properties = split.properties;
  const body = split.body;
  const title = titleFromBody(body);
  const bodyWithoutTitle = stripDocumentTitle(body);
  // Keep the managed file title in the outline as the root heading. It is
  // rendered separately in live/read views, but still owns the first subtree
  // guide and chevron so the hierarchy does not start with a missing level.
  const tocHeadings = useMemo(() => {
    return extractMarkdownHeadings(body);
  }, [body, title]);
  const previewHeadings = useMemo(() => extractMarkdownHeadings(bodyWithoutTitle, title ? 1 : 0), [bodyWithoutTitle, title]);
  const previewHeadingById = useMemo(() => new Map(previewHeadings.map((heading) => [heading.id, heading])), [previewHeadings]);
  const tocHeadingMeta = useMemo<MarkdownTocHeading[]>(() => {
    const lines = body.split(/\r?\n/);
    return tocHeadings.map((heading, index) => {
      const hasChildHeadings = Boolean(tocHeadings[index + 1]?.level > heading.level);
      const nextSectionIndex = tocHeadings.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.level <= heading.level);
      const sectionEndLine = nextSectionIndex >= 0 ? tocHeadings[nextSectionIndex].lineNumber : lines.length + 1;
      const sectionLines = lines.slice(heading.lineNumber, Math.max(heading.lineNumber, sectionEndLine - 1));
      // A leaf heading still owns a collapsible section when it has body text.
      // This keeps the affordance consistent for headings that do not have a
      // nested heading immediately after them.
      const hasSectionContent = sectionLines.some((line) => line.trim().length > 0 && !/^ {0,3}#{1,6}[ \t]+/.test(line));
      return {
        ...heading,
        hasChildHeadings,
        hasSectionContent,
        // A disclosure marker represents a nested heading tree, not ordinary
        // paragraph content. Keep body-only headings as leaf rows so the TOC
        // matches the file tree and does not imply a collapsible section.
        hasCollapsibleContent: Boolean(hasChildHeadings),
        sectionEndIndex: nextSectionIndex,
      };
    });
  }, [body, tocHeadings]);

  useEffect(() => {
    setActiveHeadingId((current) => tocHeadings.some((heading) => heading.id === current) ? current : tocHeadings[0]?.id ?? null);
  }, [tocHeadings]);

  const measureTocGuides = useMemo(() => () => {
    const list = tocListRef.current;
    const guides = tocGuidesRef.current;
    if (!list || !guides || tocHeadings.length === 0) {
      setTocGuideLayout({ contentHeight: 0, rails: [] });
      return true;
    }
    type TocGuideRow = { index: number; heading: MarkdownTocHeading; top: number; bottom: number; centerTop: number; centerLeft: number };
    const rows: TocGuideRow[] = [];
    for (let index = 0; index < tocHeadings.length; index += 1) {
      const heading = tocHeadings[index];
      const meta = tocHeadingMeta[index];
      // The heading list and its derived section metadata can be reconciled
      // on separate renders. Do not publish a partially measured layout while
      // that transient state is visible; the layout effect will retry after
      // React has committed the matching metadata.
      if (!meta) return false;
      // Callback refs can briefly lag behind the DOM during a list update.
      // Fall back to the stable data attribute so the first H1 is still
      // measured in the same layout pass as the other rows.
      // Prefer the current DOM node over the callback-ref cache. During a
      // React list reconciliation the cache can briefly contain a detached
      // node, while querySelector already sees the replacement row.
      const row = list.querySelector<HTMLElement>(`[data-toc-heading-id="${heading.id}"]`)
        ?? tocRowRefs.current.get(heading.id);
      // Do not commit a partial guide layout. During a heading list update
      // React can briefly clear and recreate callback refs; measuring only the
      // rows that survived that pass makes the first top-level rail disappear
      // until another unrelated resize happens.
      if (!row || !row.isConnected || !list.contains(row)) return false;
      const rowOffset = offsetWithin(row, list);
      if (!rowOffset) return false;
      // Keep the guide anchored to the fixed-width disclosure slot. Leaf
      // headings use the same spacer slot as the file tree so their labels do
      // not shift, and their section rail can share the exact same centre.
      const caret = row.querySelector<HTMLElement>('.markdown-toc-caret, .markdown-toc-caret-spacer');
      // Rails are positioned inside the absolute guides layer, not directly
      // inside the scrolling list. Measure the Chevron against that exact
      // layer origin so list padding, borders and WebView2 rounding cannot
      // introduce a constant horizontal/vertical offset.
      const caretOffset = caret ? offsetWithinLayer(caret, guides, list) : null;
      // The rail and its Chevron use the same guides-relative layout origin.
      // Measuring the actual icon also accounts for the row's level padding,
      // rather than duplicating those values in JavaScript.
      const fallbackCenterLeft = 16 + (Math.max(1, Math.min(6, heading.level)) - 1) * 20;
      rows.push({
        index,
        heading: meta,
        top: rowOffset.top,
        bottom: rowOffset.top + rowOffset.height,
        // Use the actual Chevron center when it exists. This keeps the
        // vertical endpoint locked to the icon even if a row's line-height
        // or padding changes between heading levels.
        centerTop: caretOffset
          ? caretOffset.top + (caretOffset.height / 2)
          : rowOffset.top + (rowOffset.height / 2),
        centerLeft: caretOffset && caret
          // `open` rotates the caret span. `offsetWidth` is the pre-transform
          // width, so it leaves the rail a couple of pixels off-center in
          // Chromium/WebView2. The measured DOMRect is post-transform.
          ? caretOffset.left + (caretOffset.width / 2)
          : fallbackCenterLeft,
      });
    }
    const rails: MarkdownTocGuideRail[] = [];
    // Each heading with nested headings owns a rail for its visible subtree.
    // Start below the parent row like the file tree, leaving a small gap after
    // the disclosure marker instead of drawing the rail through its Chevron.
    for (let index = 0; index < rows.length; index += 1) {
      const parent = rows[index];
      let lastDescendantIndex = index;
      for (let descendantIndex = index + 1; descendantIndex < rows.length; descendantIndex += 1) {
        if (rows[descendantIndex].heading.level <= parent.heading.level) break;
        lastDescendantIndex = descendantIndex;
      }
      if (lastDescendantIndex <= index) continue;
      const lastDescendant = rows[lastDescendantIndex];
      const railTop = parent.bottom + 3;
      const railEnd = Math.max(railTop + 2, lastDescendant.bottom - 3);
      rails.push({
        id: `toc-rail-${parent.heading.id}`,
        level: Math.min(6, parent.heading.level),
        left: parent.centerLeft,
        top: railTop,
        height: Math.max(2, railEnd - railTop),
        startIndex: parent.index,
        endIndex: lastDescendantIndex,
      });
    }
    const contentHeight = Math.max(list.scrollHeight, rows.at(-1)?.bottom ?? 0);
    setTocGuideLayout({ contentHeight, rails });
    return true;
  }, [tocHeadings, tocHeadingMeta]);

  useLayoutEffect(() => {
    if (!tocOpen) {
      setTocGuideLayout({ contentHeight: 0, rails: [] });
      return undefined;
    }
    let frame = 0;
    let retryCount = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      retryCount = 0;
      const measure = () => {
        frame = window.requestAnimationFrame(() => {
          if (measureTocGuides()) return;
          // Callback refs can be briefly incomplete while the heading list is
          // reconciled. Retry a few frames so the first H1 is not omitted
          // until a later resize or scroll happens to trigger measurement.
          if (retryCount < 12) {
            retryCount += 1;
            measure();
          }
        });
      };
      measure();
    };
    schedule();
    const list = tocListRef.current;
    const observer = typeof ResizeObserver === 'undefined' || !list ? null : new ResizeObserver(schedule);
    if (observer && list) observer.observe(list);
    const mutationObserver = typeof MutationObserver === 'undefined' || !list ? null : new MutationObserver(schedule);
    // A heading list can change its scroll height without resizing the list
    // itself. Observe child replacement so rails are recalculated after
    // editor updates and the first top-level row cannot remain stale.
    if (mutationObserver && list) mutationObserver.observe(list, { childList: true, subtree: true });
    list?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      mutationObserver?.disconnect();
      list?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [measureTocGuides, tocOpen]);

  useEffect(() => {
    setPropertyTypes({});
    setPropertyPickerOpen(false);
    setPropertyMenuKey(null);
    setOperationError('');
  }, [documentId]);

  // Derive from the latest state instead of the render that created the event
  // handler. CodeMirror can deliver an edit while React is still committing a
  // previous edit; closing over `body` in that case resurrects the old title.
  const updateBody = (nextBody: string) => setContent((current) => {
    return replaceMarkdownBody(current, nextBody);
  });
  const updateProperties = (nextProperties: DocumentProperties) => {
    try { setContent((current) => updateMarkdownProperties(current, nextProperties)); setOperationError(''); }
    catch (error) { setOperationError(String(error)); return; }
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
  const insertMarkdown = (before: string, after = '', placeholder = '') => {
    if (editSurface === 'live') {
      liveEditorRef.current?.insertMarkdown(before, after, placeholder);
      return;
    }
    liveEditorRef.current?.insertMarkdown(before, after, placeholder);
  };

  const insertLink = () => {
    const url = window.prompt('\u94fe\u63a5\u5730\u5740', 'https://');
    if (url) insertMarkdown('[', '](' + url + ')', '\u94fe\u63a5\u6587\u5b57');
  };

  const insertImageUrl = () => {
    const url = window.prompt('\u56fe\u7247\u5730\u5740\uff08\u652f\u6301 https:// \u6216\u76f8\u5bf9\u8def\u5f84\uff09', 'https://');
    if (url) insertMarkdown('![', '](' + url + ')', '\u56fe\u7247\u8bf4\u660e');
  };

  const insertImageFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') insertMarkdown('![', '](' + reader.result + ')', file.name.replace(/\.[^.]+$/, ''));
    };
    reader.readAsDataURL(file);
  };

  const openEditorContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setEditorMenuSection(null);
    setEditorHasSelection(liveEditorRef.current?.hasSelection() ?? false);
    const submenuSide = window.innerWidth - event.clientX >= 520 ? 'right' : 'left';
    const verticalSide = window.innerHeight - event.clientY >= 470 ? 'top' : 'bottom';
    const menuWidth = 260;
    const submenuWidth = 224;
    const edge = 8;
    const maxX = submenuSide === 'right'
      ? window.innerWidth - menuWidth - submenuWidth - edge * 2
      : window.innerWidth - menuWidth - edge;
    setEditorContextMenu({
      x: Math.max(edge, Math.min(event.clientX, maxX)),
      y: Math.max(edge, Math.min(event.clientY, window.innerHeight - edge)),
      submenuSide,
      verticalSide,
    });
  };

  const insertEditorSnippet = (snippet: string) => {
    insertMarkdown('', '', snippet);
    setEditorContextMenu(null);
    setEditorMenuSection(null);
  };

  const openDatePicker = (event: MouseEvent<HTMLButtonElement>) => {
    const input = event.currentTarget.nextElementSibling as HTMLInputElement | null;
    if (!input) return;
    input.focus();
    input.showPicker?.();
  };

  const insertEditorFormat = (before: string, after: string, placeholder: string) => {
    insertMarkdown(before, after, placeholder);
    setEditorContextMenu(null);
    setEditorMenuSection(null);
  };

  const clearEditorFormatting = () => {
    if (!liveEditorRef.current?.hasSelection()) return;
    liveEditorRef.current?.clearFormatting();
    closeEditorContextMenu();
  };

  const pastePlainText = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) insertMarkdown('', '', text);
    } catch {
      runEditorCommand('paste');
      return;
    }
    closeEditorContextMenu();
  };

  const closeEditorContextMenu = () => {
    setEditorMenuSection(null);
    setEditorContextMenu(null);
  };

  const runEditorCommand = (command: 'cut' | 'copy' | 'paste' | 'selectAll') => {
    if ((command === 'cut' || command === 'copy') && !liveEditorRef.current?.hasSelection()) return;
    liveEditorRef.current?.focus();
    document.execCommand(command === 'selectAll' ? 'selectAll' : command);
    setEditorContextMenu(null);
    setEditorMenuSection(null);
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

  useEffect(() => {
    if (!editorContextMenu) return undefined;
    const close = () => { setEditorContextMenu(null); setEditorMenuSection(null); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [editorContextMenu]);

  // A document/mode/loading transition creates a new editor session. The
  // session id lets the parent reject transactions delivered after an old
  // CodeMirror instance has been replaced.
  const editorSessionPhase = loading || error ? 'pending' : 'ready';
  // A file rename migrates the same document; only a new session or mode
  // invalidates callbacks and rebuilds CodeMirror.
  const editorSessionKey = `${documentId}\u0000${mode}\u0000${editSurface}\u0000${editorSessionPhase}`;
  if (activeEditorSessionRef.current.key !== editorSessionKey) {
    const nextId = ++editorSessionCounterRef.current;
    activeEditorSessionRef.current = { key: editorSessionKey, id: nextId };
    editorBodyRef.current = (editSurface === 'live' ? bodyWithoutTitle : body).replace(/\r\n/g, '\n');
  }
  const editorSessionId = activeEditorSessionRef.current.id;
  const updateEditorBody = (nextBody: string, context?: MarkdownEditorChangeContext) => {
    if (context?.sourceMode) return;
    if (!context || context.sessionId !== activeEditorSessionRef.current.id) return;
    // CodeMirror reports the document immediately before each transaction.
    // Requiring that snapshot to match the last accepted body keeps queued
    // events from an obsolete editor from being applied to the new document.
    if (context.previousMarkdown !== editorBodyRef.current) return;
    editorBodyRef.current = nextBody;
    setContent((current) => {
      return replaceMarkdownLiveBody(current, nextBody);
    });
  };
  const updateSourceBody = (nextBody: string, context?: MarkdownEditorChangeContext) => {
    // A mode switch can leave one already-queued transaction in the old
    // editor. Never let a live-preview callback overwrite the full source
    // document, or vice versa.
    if (!context?.sourceMode) return;
    if (context.sessionId !== activeEditorSessionRef.current.id) return;
    if (context.previousMarkdown !== editorBodyRef.current) return;
    editorBodyRef.current = nextBody;
    updateBody(nextBody);
  };
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

  const headingIdForNode = (node?: { position?: { start?: { line?: number } } }) => {
    const heading = previewHeadings.find((candidate) => candidate.lineNumber === node?.position?.start?.line);
    return heading?.id;
  };
  const navigateToHeading = (heading: MarkdownHeading) => {
    setActiveHeadingId(heading.id);
    if (mode === 'read') {
      window.requestAnimationFrame(() => {
        contentScrollerRef.current
          ?.querySelector<HTMLElement>(`[data-markdown-heading-id="${heading.id}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return;
    }
    if (editSurface === 'live' && title && heading.id === tocHeadings[0]?.id) {
      titleInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const previewHeading = previewHeadingById.get(heading.id);
    liveEditorRef.current?.scrollToLine(editSurface === 'live' ? (previewHeading?.lineNumber ?? 1) : heading.lineNumber);
  };

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
  const activeTocIndex = useMemo(() => tocHeadings.findIndex((heading) => heading.id === activeHeadingId), [tocHeadings, activeHeadingId]);
  const hoveredTocIndex = useMemo(() => tocHeadings.findIndex((heading) => heading.id === hoveredHeadingId), [tocHeadings, hoveredHeadingId]);

  return (
    <section className="markdown-resource-tab">
      <header className="markdown-resource-toolbar">
        <div className="markdown-resource-mode-switch" role="group" aria-label="Markdown \u89c6\u56fe\u6a21\u5f0f">
          <button type="button" className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')} title="\u7f16\u8f91 Markdown" aria-label="\u7f16\u8f91 Markdown"><Pencil size={14} aria-hidden="true" /><span>{'\u7f16\u8f91'}</span></button>
          <button type="button" className={mode === 'read' ? 'active' : ''} onClick={() => setMode('read')} title="\u9605\u8bfb\u6e32\u67d3\u7ed3\u679c" aria-label="\u9605\u8bfb\u6e32\u67d3\u7ed3\u679c"><BookOpen size={14} aria-hidden="true" /><span>{'\u9605\u8bfb'}</span></button>
        </div>
        <button type="button" className={'markdown-toc-toggle' + (tocOpen ? ' active' : '')} onClick={() => setTocOpen((open) => !open)} title={tocOpen ? '关闭目录' : '打开目录'} aria-label={tocOpen ? '关闭目录' : '打开目录'} aria-pressed={tocOpen}><ListTree size={16} aria-hidden="true" /><span>目录</span></button>
        {mode === 'edit' && <div className="markdown-source-tools" role="toolbar" aria-label="Markdown \u683c\u5f0f\u5de5\u5177">
          <button type="button" onClick={() => insertMarkdown('# ', '', '\u6807\u9898')} title="\u63d2\u5165\u4e00\u7ea7\u6807\u9898" aria-label="\u63d2\u5165\u4e00\u7ea7\u6807\u9898"><Heading1 size={14} /></button>
          <button type="button" onClick={() => insertMarkdown('**', '**', '\u7c97\u4f53')} title="\u63d2\u5165\u7c97\u4f53" aria-label="\u63d2\u5165\u7c97\u4f53"><Bold size={14} /></button>
          <button type="button" onClick={() => insertMarkdown('- ', '', '\u5217\u8868\u9879')} title="\u63d2\u5165\u65e0\u5e8f\u5217\u8868" aria-label="\u63d2\u5165\u65e0\u5e8f\u5217\u8868"><List size={14} /></button>
          <button type="button" onClick={() => insertMarkdown('1. ', '', '\u5217\u8868\u9879')} title="\u63d2\u5165\u6709\u5e8f\u5217\u8868" aria-label="\u63d2\u5165\u6709\u5e8f\u5217\u8868"><ListOrdered size={14} /></button>
          <button type="button" onClick={insertLink} title="\u63d2\u5165\u94fe\u63a5" aria-label="\u63d2\u5165\u94fe\u63a5"><LinkIcon size={14} /></button>
          <button type="button" onClick={() => imageInputRef.current?.click()} title="\u63d2\u5165\u56fe\u7247" aria-label="\u63d2\u5165\u56fe\u7247"><ImagePlus size={14} /></button>
          <button type="button" onClick={insertImageUrl} title="\u63d2\u5165\u56fe\u7247\u5730\u5740" aria-label="\u63d2\u5165\u56fe\u7247\u5730\u5740"><LinkIcon size={14} /></button>
          <button type="button" className={editSurface === 'source' ? 'active' : ''} onClick={() => setEditSurface((surface) => surface === 'live' ? 'source' : 'live')} title={editSurface === 'live' ? '\u5207\u6362\u4e3a\u5b8c\u6574\u6e90\u7801' : '\u5207\u6362\u4e3a\u5b9e\u65f6\u9884\u89c8'} aria-label={editSurface === 'live' ? '\u5207\u6362\u4e3a\u5b8c\u6574\u6e90\u7801' : '\u5207\u6362\u4e3a\u5b9e\u65f6\u9884\u89c8'}><Code2 size={14} /></button>
        </div>}
        <input ref={imageInputRef} className="markdown-image-input" type="file" accept="image/*" onChange={(event) => { insertImageFile(event.target.files?.[0]); event.target.value = ''; }} />
        <span className={'markdown-save-state ' + saveState}>{saveState === 'saving' && <LoaderCircle size={13} className="spin" aria-hidden="true" />}{saveState === 'saved' && <Check size={13} aria-hidden="true" />}{saveState === 'saving' ? '\u4fdd\u5b58\u4e2d' : saveState === 'error' ? '\u4fdd\u5b58\u5931\u8d25' : '\u5df2\u4fdd\u5b58'}</span>
      </header>
      {(saveError || operationError) && <div className="file-tab-hint error" role="alert">
        <span>{saveError || operationError}</span>
        {saveError && <>
          <button type="button" onClick={saveImmediately}>重试保存</button>
          <button type="button" onClick={() => {
            const url = URL.createObjectURL(new Blob([contentRef.current], { type: 'text/markdown;charset=utf-8' }));
            const anchor = document.createElement('a'); anchor.href = url; anchor.download = name.replace(/\.md$/i, '') + '.local-draft.md'; anchor.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>导出本地草稿</button>
          <button type="button" onClick={() => { if (window.confirm('重新加载会丢弃当前编辑草稿，请先导出需要保留的内容。继续？')) void reload(); }}>重新加载磁盘版本</button>
        </>}
      </div>}
      <div className={`markdown-resource-body mode-${mode}${tocOpen ? ' has-toc' : ''}`}>
        <div ref={contentScrollerRef} className="markdown-resource-content">
        {loading && <p className="file-tab-hint">{'\u6b63\u5728\u52a0\u8f7d\u6587\u4ef6\u2026'}</p>}
        {!loading && error && <p className="file-tab-hint error">{error}</p>}
        {!loading && !error && mode === 'edit' && <div className="markdown-editor-layout">
          {editSurface === 'live' && <MarkdownDocumentTitle key={documentId} inputRef={titleInputRef} path={path} name={name}
            title={title || displayTitle} onRenamed={onRenamed} onError={setOperationError} />}
          {editSurface === 'live' && <aside ref={propertiesPanelRef} className={'markdown-properties' + (propertiesVisible ? '' : ' is-collapsed')} aria-label="\u7b14\u8bb0\u5c5e\u6027">
            <div className="markdown-properties-heading"><div><strong>{'\u7b14\u8bb0\u5c5e\u6027'}</strong><small>常用属性可直接选择，值会同步到文档 YAML</small></div><button type="button" className={propertiesVisible ? 'expanded' : 'collapsed'} onClick={() => setPropertiesVisible((visible) => !visible)} title={propertiesVisible ? "\u6536\u8d77\u5c5e\u6027" : "\u5c55\u5f00\u5c5e\u6027"} aria-label={propertiesVisible ? "\u6536\u8d77\u5c5e\u6027" : "\u5c55\u5f00\u5c5e\u6027"}><ChevronRight size={18} aria-hidden="true" /></button></div>
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
          </aside>}
          <div className="markdown-editor-context-shell" onContextMenu={openEditorContextMenu}>
            <MarkdownLivePreviewEditor key={editSurface} ref={liveEditorRef} markdown={editSurface === 'live' ? bodyWithoutTitle : body} sourceMode={editSurface === 'source'} sessionId={editorSessionId} onChange={editSurface === 'live' ? updateEditorBody : updateSourceBody} onBlur={saveImmediately} onOpenWikiLink={openWikiLink} placeholder={'\u5f00\u59cb\u5199\u2026'} />
            {editorContextMenu && createPortal(<div className={`markdown-editor-context-menu${editorContextMenu.submenuSide === 'left' ? ' submenu-left' : ''}${editorContextMenu.verticalSide === 'bottom' ? ' menu-bottom' : ''}`} style={{ left: editorContextMenu.x, top: editorContextMenu.y }} onClick={(event) => event.stopPropagation()} role="menu" aria-label="Markdown 编辑菜单">
              <button type="button" onClick={() => { insertLink(); closeEditorContextMenu(); }}><LinkIcon size={17} aria-hidden="true" /><span>新增链接</span></button>
              <button type="button" onClick={() => { insertLink(); closeEditorContextMenu(); }}><ExternalLink size={17} aria-hidden="true" /><span>新增外部链接</span></button>
              <div className="markdown-editor-menu-parent" onMouseEnter={() => setEditorMenuSection('format')}>
                <button type="button" aria-haspopup="menu" aria-expanded={editorMenuSection === 'format'} onFocus={() => setEditorMenuSection('format')} onClick={() => setEditorMenuSection((section) => section === 'format' ? null : 'format')}><Bold size={17} aria-hidden="true" /><span>文本格式</span><ChevronRight size={16} aria-hidden="true" /></button>
                {editorMenuSection === 'format' && <div className="markdown-editor-submenu" role="menu" aria-label="文本格式">
                  <button type="button" onClick={() => insertEditorFormat('**', '**', '粗体')}><Bold size={17} aria-hidden="true" /><span>加粗</span></button>
                  <button type="button" onClick={() => insertEditorFormat('*', '*', '倾斜')}><Italic size={17} aria-hidden="true" /><span>倾斜</span></button>
                  <button type="button" onClick={() => insertEditorFormat('~~', '~~', '删除线')}><Strikethrough size={17} aria-hidden="true" /><span>删除线</span></button>
                  <button type="button" onClick={() => insertEditorFormat('==', '==', '高亮')}><Highlighter size={17} aria-hidden="true" /><span>高亮</span></button>
                  <button type="button" onClick={() => insertEditorFormat('`', '`', '代码')}><Code2 size={17} aria-hidden="true" /><span>行内代码</span></button>
                  <div className="markdown-editor-submenu-divider" />
                   <button type="button" disabled={!editorHasSelection} onClick={clearEditorFormatting}><Eraser size={17} aria-hidden="true" /><span>清除格式</span></button>
                 </div>}
               </div>
               <div className="markdown-editor-menu-parent" onMouseEnter={() => setEditorMenuSection('paragraph')}>
                <button type="button" aria-haspopup="menu" aria-expanded={editorMenuSection === 'paragraph'} onFocus={() => setEditorMenuSection('paragraph')} onClick={() => setEditorMenuSection((section) => section === 'paragraph' ? null : 'paragraph')}><Pilcrow size={17} aria-hidden="true" /><span>段落设置</span><ChevronRight size={16} aria-hidden="true" /></button>
                {editorMenuSection === 'paragraph' && <div className="markdown-editor-submenu" role="menu" aria-label="段落设置">
                  <button type="button" onClick={() => insertEditorSnippet('- 列表项')}><List size={17} aria-hidden="true" /><span>无序列表</span></button>
                  <button type="button" onClick={() => insertEditorSnippet('1. 列表项')}><ListOrdered size={17} aria-hidden="true" /><span>有序列表</span></button>
                  <button type="button" onClick={() => insertEditorSnippet('- [ ] 任务项')}><ListChecks size={17} aria-hidden="true" /><span>任务列表</span></button>
                  <div className="markdown-editor-submenu-divider" />
                  <button type="button" onClick={() => insertEditorSnippet('# 标题')}><Heading1 size={17} aria-hidden="true" /><span>1级标题</span></button>
                  <button type="button" onClick={() => insertEditorSnippet('## 标题')}><Heading2 size={17} aria-hidden="true" /><span>2级标题</span></button>
                  <button type="button" onClick={() => insertEditorSnippet('### 标题')}><Heading3 size={17} aria-hidden="true" /><span>3级标题</span></button>
                  <button type="button" onClick={() => insertEditorSnippet('#### 标题')}><Heading4 size={17} aria-hidden="true" /><span>4级标题</span></button>
                  <button type="button" onClick={() => insertEditorSnippet('##### 标题')}><Heading5 size={17} aria-hidden="true" /><span>5级标题</span></button>
                  <button type="button" onClick={() => insertEditorSnippet('###### 标题')}><Heading6 size={17} aria-hidden="true" /><span>6级标题</span></button>
                  <button type="button" onClick={() => insertEditorSnippet('正文')}><Pilcrow size={17} aria-hidden="true" /><span>正文</span></button>
                  <button type="button" onClick={() => insertEditorSnippet('> 引用内容')}><Quote size={17} aria-hidden="true" /><span>引用</span></button>
                </div>}
              </div>
              <div className="markdown-editor-menu-parent" onMouseEnter={() => setEditorMenuSection('insert')}>
                <button type="button" aria-haspopup="menu" aria-expanded={editorMenuSection === 'insert'} onFocus={() => setEditorMenuSection('insert')} onClick={() => setEditorMenuSection((section) => section === 'insert' ? null : 'insert')}><Plus size={17} aria-hidden="true" /><span>插入</span><ChevronRight size={16} aria-hidden="true" /></button>
                {editorMenuSection === 'insert' && <div className="markdown-editor-submenu" role="menu" aria-label="插入">
                  <button type="button" onClick={() => insertEditorSnippet('[^1]: 脚注内容')}><span className="markdown-editor-menu-glyph">¹</span><span>脚注</span></button>
                  <button type="button" onClick={() => insertEditorSnippet('| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |')}><Table2 size={17} aria-hidden="true" /><span>表格</span></button>
                  <button type="button" onClick={() => insertEditorSnippet('> [!NOTE] 提示\n> 在这里输入内容')}><Quote size={17} aria-hidden="true" /><span>标注块</span></button>
                  <button type="button" onClick={() => insertEditorSnippet('---')}><Minus size={17} aria-hidden="true" /><span>分隔线</span></button>
                  <div className="markdown-editor-submenu-divider" />
                  <button type="button" onClick={() => insertEditorSnippet('```text\n代码\n```')}><Code2 size={17} aria-hidden="true" /><span>代码块</span></button>
                  <button type="button" onClick={() => insertEditorSnippet('$$\n公式\n$$')}><Sigma size={17} aria-hidden="true" /><span>数学块</span></button>
                </div>}
              </div>
              <div className="markdown-editor-menu-divider" />
              <button type="button" disabled={!editorHasSelection} onClick={() => runEditorCommand('cut')}><Scissors size={17} aria-hidden="true" /><span>剪切</span></button>
              <button type="button" disabled={!editorHasSelection} onClick={() => runEditorCommand('copy')}><Clipboard size={17} aria-hidden="true" /><span>复制</span></button>
              <button type="button" onClick={() => runEditorCommand('paste')}><ClipboardPaste size={17} aria-hidden="true" /><span>粘贴</span></button>
              <button type="button" onClick={() => { void pastePlainText(); }}><ClipboardPaste size={17} aria-hidden="true" /><span>以纯文本形式粘贴</span></button>
              <button type="button" onClick={() => runEditorCommand('selectAll')}><CheckSquare size={17} aria-hidden="true" /><span>全选</span></button>
            </div>, document.body)}
            {propertyDragPreview && createPortal(<div className="markdown-property-drag-preview" style={{ left: propertyDragPreview.left, top: propertyDragPreview.top, width: propertyDragPreview.width, height: propertyDragPreview.height }} aria-hidden="true">
              <span className="markdown-property-drag-preview-icon">{propertyIcon(propertyDragPreview.key, propertyDragPreview.type)}</span>
              <span className="markdown-property-drag-preview-name">{propertyDragPreview.label}</span>
              <span className="markdown-property-drag-preview-value">{propertyDragPreview.value}</span>
            </div>, document.body)}
          </div>
        </div>}
         {!loading && !error && mode === 'read' && <article className="md-body markdown-resource-preview markdown-preview">{title && <h1 className="markdown-document-title" id={tocHeadings[0]?.id} data-markdown-heading-id={tocHeadings[0]?.id}>{title}</h1>}{Object.keys(properties).length > 0 && <div className="markdown-property-summary" aria-label="文档属性">{Object.entries(properties).map(([key, value]) => <span key={key} className="markdown-property-summary-item"><span className="markdown-property-summary-label">{propertyLabel(key)}</span><strong>{Array.isArray(value) ? value.join('、') || '未设置' : typeof value === 'boolean' ? (value ? '是' : '否') : value || '未设置'}</strong></span>)}</div>}<div className="markdown-content-start"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkAsterInline]} rehypePlugins={[rehypeKatex]} urlTransform={safeMarkdownUrl} components={{ section: ({ children, ...props }) => ('data-footnotes' in props ? <MarkdownFootnotesSection>{children}</MarkdownFootnotesSection> : <section {...props}>{children}</section>), a: ({ href, children, ...props }) => ('data-footnote-ref' in props ? <MarkdownFootnoteRef href={href}>{children}</MarkdownFootnoteRef> : 'data-footnote-backref' in props ? <MarkdownFootnoteBackref href={href}>{children}</MarkdownFootnoteBackref> : href?.startsWith(wikiLinkProtocol) ? <button type="button" className={onOpenWikiLink ? 'markdown-wiki-link' : 'markdown-wiki-link is-unresolved'} title={`笔记链接：${wikiLinkTarget(href)}`} onClick={() => openWikiLink(wikiLinkTarget(href))}>{children}</button> : href?.startsWith('a4note-highlight:') ? <mark className="markdown-inline-highlight">{children}</mark> : <a className="markdown-link" data-external={/^https?:/i.test(href ?? '') ? 'true' : undefined} href={href} target="_blank" rel="noreferrer" onClick={(event) => { if (!href) return; event.preventDefault(); void openExternalUrl(href).catch(() => window.open(href, '_blank', 'noopener,noreferrer')); }}>{children}</a>), blockquote: MarkdownCallout, pre: MarkdownCodeBlock, table: MarkdownTable, img: ({ src, alt, title }) => <MarkdownImage src={src} alt={alt} title={title} documentPath={path} />, h1: ({ node, ...props }) => <h1 {...props} id={headingIdForNode(node)} data-markdown-heading-id={headingIdForNode(node)} />, h2: ({ node, ...props }) => <h2 {...props} id={headingIdForNode(node)} data-markdown-heading-id={headingIdForNode(node)} />, h3: ({ node, ...props }) => <h3 {...props} id={headingIdForNode(node)} data-markdown-heading-id={headingIdForNode(node)} />, h4: ({ node, ...props }) => <h4 {...props} id={headingIdForNode(node)} data-markdown-heading-id={headingIdForNode(node)} />, h5: ({ node, ...props }) => <h5 {...props} id={headingIdForNode(node)} data-markdown-heading-id={headingIdForNode(node)} />, h6: ({ node, ...props }) => <h6 {...props} id={headingIdForNode(node)} data-markdown-heading-id={headingIdForNode(node)} /> }}>{normalizeEmbeddedMarkdown(bodyWithoutTitle)}</ReactMarkdown></div></article>}
        </div>
        {tocOpen && <aside className="markdown-toc-panel" aria-label="文档目录">
          {tocHeadings.length > 0 ? <nav ref={tocListRef} className="markdown-toc-list" aria-label="文档标题列表">
            <div ref={tocGuidesRef} className="markdown-toc-guides" aria-hidden="true" style={{ height: `${Math.max(tocGuideLayout.contentHeight, 1)}px` }}>
              {tocGuideLayout.rails.map((rail) => {
                const highlighted = (activeTocIndex >= rail.startIndex && activeTocIndex <= rail.endIndex)
                  || (hoveredTocIndex >= rail.startIndex && hoveredTocIndex <= rail.endIndex);
                return <span key={rail.id} className={`markdown-toc-guide-rail${highlighted ? ' highlighted' : ''}`} data-guide-level={rail.level} style={{ left: rail.left, top: rail.top, height: rail.height }} />;
              })}
            </div>
            {tocHeadingMeta.map((heading) => {
              // The managed document title is the root of the outline. Keep
              // its disclosure affordance visible even when the section is
              // temporarily empty while the editor is being reconciled.
              const showCaret = heading.hasChildHeadings;
              return <button
              type="button"
              key={heading.id}
              ref={(node) => { if (node) tocRowRefs.current.set(heading.id, node); else tocRowRefs.current.delete(heading.id); }}
              className={`markdown-toc-item level-${heading.level}${activeHeadingId === heading.id ? ' active' : ''}`}
              onClick={() => navigateToHeading(heading)}
              onMouseEnter={() => setHoveredHeadingId(heading.id)}
              onMouseLeave={() => setHoveredHeadingId(null)}
              title={heading.text}
              data-toc-level={heading.level}
              data-toc-heading-id={heading.id}
            >{showCaret ? <span className="markdown-toc-caret open" aria-hidden="true"><ChevronRight size={17} strokeWidth={2.35} /></span> : <span className="markdown-toc-caret-spacer" aria-hidden="true" />}<span className="markdown-toc-label">{heading.text}</span></button>;
            })}
          </nav> : <p className="markdown-toc-empty">当前笔记还没有标题</p>}
        </aside>}
      </div>
    </section>
  );
}

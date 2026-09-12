import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, CircleHelp, Info, Lightbulb, Quote, TriangleAlert } from 'lucide-react';

/**
 * Obsidian-style callout blocks (`> [!NOTE] title`).
 *
 * Shared because every Markdown surface has to agree on the DOM: the notes tab
 * and the reader render the same document, so a callout that only one of them
 * knows how to parse shows up as a plain quote with a literal `[!NOTE]` in the
 * other. The matching styling lives in `src/ui/styles/markdown.css` under
 * `.md-body blockquote.markdown-callout`.
 */

/** Flattens a ReactMarkdown child tree back into plain text. */
export function markdownNodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(markdownNodeText).join('');
  if (isValidElement(node)) return markdownNodeText((node.props as { children?: ReactNode }).children);
  return '';
}

function calloutIcon(type: string) {
  switch (type) {
    case 'tip':
    case 'hint': return <Lightbulb size={17} aria-hidden="true" />;
    case 'warning':
    case 'caution': return <TriangleAlert size={17} aria-hidden="true" />;
    case 'danger':
    case 'error': return <CircleAlert size={17} aria-hidden="true" />;
    case 'success':
    case 'check': return <CheckCircle2 size={17} aria-hidden="true" />;
    case 'question':
    case 'help': return <CircleHelp size={17} aria-hidden="true" />;
    case 'quote': return <Quote size={17} aria-hidden="true" />;
    default: return <Info size={17} aria-hidden="true" />;
  }
}

const calloutLabels: Record<string, string> = {
  abstract: '摘要',
  caution: '注意',
  danger: '危险',
  error: '错误',
  example: '示例',
  help: '帮助',
  hint: '提示',
  important: '重要',
  info: '信息',
  note: '笔记',
  question: '问题',
  quote: '引用',
  success: '成功',
  tip: '技巧',
  todo: '待办',
  warning: '警告',
};

/** True when the type is one of the built-ins with a localized label. */
export function isKnownCalloutType(type: string) {
  return Object.hasOwn(calloutLabels, type);
}

export function calloutLabel(type: string) {
  return calloutLabels[type] ?? type.toUpperCase();
}

const markerPattern = /^\s*\[!([A-Za-z]+)\]\s*([^\n]*)/;

/**
 * Drops the `[!TYPE] title` line from the callout's first block, keeping the
 * rest of that paragraph. The marker text may share a text node with the body
 * (a soft line break stays inside one mdast text value) or sit alongside inline
 * elements, so the search is by child rather than by assuming a lone string.
 */
function stripMarkerLine(block: ReactElement): ReactNode {
  const children = (block.props as { children?: ReactNode }).children;
  const list: ReactNode[] = Array.isArray(children) ? [...children] : [children];
  const index = list.findIndex((child) => typeof child === 'string' && markerPattern.test(child));
  if (index === -1) return block;
  const remainder = (list[index] as string).replace(/^\s*\[![A-Za-z]+\]\s*[^\n]*(?:\n|$)/, '').replace(/^[ \t]+/, '');
  if (remainder) list[index] = remainder;
  else list.splice(index, 1);
  const kept = list.filter((child) => child !== null && child !== undefined && child !== '');
  return kept.length > 0 ? cloneElement(block, {}, ...kept) : null;
}

/** `blockquote` renderer: a callout when the first block carries a marker, a plain quote otherwise. */
export function MarkdownCallout({ children }: { children?: ReactNode }) {
  const blocks = Children.toArray(children);
  // remark-rehype pads block children with "\n" text nodes, so the marker is
  // never at index 0 — looking there is what kept every callout rendering as a
  // plain quote with a literal `[!NOTE]` in the text.
  const firstIndex = blocks.findIndex((block) => isValidElement(block));
  const firstBlock = firstIndex === -1 ? undefined : blocks[firstIndex];
  const marker = firstBlock ? markdownNodeText(firstBlock).match(markerPattern) : null;
  if (!marker || !isValidElement(firstBlock)) return <blockquote>{children}</blockquote>;

  const type = marker[1].toLowerCase();
  const known = isKnownCalloutType(type);
  const label = calloutLabel(type);
  const title = marker[2].trim() || label;
  return <blockquote className={`markdown-callout markdown-callout-${type}`} data-callout-type={type}>
    <div className="markdown-callout-heading">
      <span className="markdown-callout-icon">{calloutIcon(type)}</span>
      <div className="markdown-callout-heading-main">
        {/* An unknown type has no localized label, and the badge on the right
            already shows the raw name — printing it twice reads like a bug. */}
        {known && <span className="markdown-callout-label">{label}</span>}
        <strong>{title}</strong>
      </div>
      <span className="markdown-callout-kind">{type.toUpperCase()}</span>
    </div>
    <div className="markdown-callout-content">{stripMarkerLine(firstBlock)}{blocks.slice(firstIndex + 1)}</div>
  </blockquote>;
}

/**
 * Inline syntax this app adds on top of GFM.
 *
 *   ==高亮==                  → <mark>
 *   <mark>/<kbd>/<u>/<sub>…   → the same element, from a fixed allow-list
 *   [[目标]] / [[目标|别名]]   → an internal note link (`a4note-wiki:` URL)
 *
 * Why a plugin instead of `rehype-raw`: raw HTML would render *everything* a
 * note contains, including `<script>` and `on*` handlers, inside a Tauri webview
 * that has access to app APIs. Notes here are not always hand-written — papers
 * and translations are imported — so the allow-list stays narrow and the only
 * attribute carried over is `title`. Anything outside the list keeps rendering
 * as escaped text, exactly as before.
 *
 * Inline HTML tags are separate mdast nodes. Pair only allow-listed tokens,
 * keeping already-parsed Markdown children; never enable raw HTML rendering.
 */

/** Minimal structural mdast shapes; keeps the module free of type-package coupling. */
type MdNode = {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
};

/** Nodes whose text is verbatim: never rewrite inside them. */
const opaqueNodes = new Set(['code', 'inlineCode', 'math', 'inlineMath', 'html', 'yaml', 'toml', 'definition']);

/** HTML that Markdown itself cannot express. `em`/`strong`/`code` stay out: use Markdown. */
const allowedTags = 'mark|kbd|u|sub|sup|s|small|abbr';

const inlinePattern = new RegExp(
  [
    // No space just inside the markers, so prose like `a == b == c` is left alone.
    '==(?<highlight>[^\\s=][^\\n=]*[^\\s=]|[^\\s=])==',
    '\\[\\[(?<wiki>[^\\]\\n|]+)(?:\\|(?<alias>[^\\]\\n]+))?\\]\\]',
  ].join('|'),
  'gi',
);

/** Only `title` survives from an inline tag's attributes. */
function titleProperty(attrs: string | undefined) {
  const match = attrs?.match(/title\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const title = match?.[1] ?? match?.[2];
  return title ? { title } : undefined;
}

function elementNode(tag: string, value: string, properties?: Record<string, string>): MdNode {
  return {
    type: 'emphasis',
    data: { hName: tag, ...(properties ? { hProperties: properties } : {}) },
    children: [{ type: 'text', value }],
  };
}

function wikiLinkNode(target: string, alias: string | undefined): MdNode {
  const trimmed = target.trim();
  return {
    type: 'link',
    url: `a4note-wiki:${encodeURIComponent(trimmed)}`,
    title: null,
    data: { hProperties: { 'data-wiki-target': trimmed } },
    children: [{ type: 'text', value: (alias ?? trimmed).trim() }],
  };
}

/** Splits one text node, or returns null when nothing matched. */
function splitText(value: string, insideLink: boolean): MdNode[] | null {
  inlinePattern.lastIndex = 0;
  let match = inlinePattern.exec(value);
  if (!match) return null;

  const parts: MdNode[] = [];
  let cursor = 0;
  while (match) {
    const groups = match.groups ?? {};
    // A wiki link inside a link would nest anchors, so leave the text alone.
    const skip = Boolean(groups.wiki) && insideLink;
    if (!skip) {
      if (match.index > cursor) parts.push({ type: 'text', value: value.slice(cursor, match.index) });
      if (groups.highlight) parts.push(elementNode('mark', groups.highlight));
      else if (groups.wiki) parts.push(wikiLinkNode(groups.wiki, groups.alias));
      cursor = match.index + match[0].length;
    }
    match = inlinePattern.exec(value);
  }
  if (parts.length === 0) return null;
  if (cursor < value.length) parts.push({ type: 'text', value: value.slice(cursor) });
  return parts;
}

/** Pair inline HTML siblings. No arbitrary HTML or attributes reach the DOM. */
function pairInlineTags(children: MdNode[]): MdNode[] {
  const output: MdNode[] = [];
  const stack: { tag: string; opening: MdNode; children: MdNode[]; properties?: Record<string, string> }[] = [];
  const append = (node: MdNode) => (stack.length ? stack[stack.length - 1].children : output).push(node);
  const token = new RegExp(`^<(\\/?)(?<tag>${allowedTags})(?<attrs>\\s[^>]*?)?>$`, 'i');
  for (const child of children) {
    const raw = child.type === 'html' ? child.value?.trim() : undefined;
    if (raw && /^<br\s*\/?>$/i.test(raw)) { append({ type: 'break' }); continue; }
    const match = raw?.match(token);
    if (!match) { append(child); continue; }
    const tag = match.groups!.tag.toLowerCase();
    if (!match[1]) {
      stack.push({ tag, opening: child, children: [], properties: titleProperty(match.groups?.attrs) });
    } else if (stack.length && stack[stack.length - 1].tag === tag) {
      const frame = stack.pop()!;
      const element = elementNode(tag, '', frame.properties);
      element.children = frame.children;
      append(element);
    } else {
      // Malformed/unmatched closing tag stays inert, not an executable DOM node.
      append(child);
    }
  }
  // Unclosed openings remain inert and do not underline unrelated following text.
  while (stack.length) {
    const frame = stack.pop()!;
    append(frame.opening);
    for (const child of frame.children) append(child);
  }
  return output;
}

function transform(node: MdNode, insideLink: boolean) {
  if (!node.children || opaqueNodes.has(node.type)) return;
  const nested = insideLink || node.type === 'link' || node.type === 'linkReference';
  const next: MdNode[] = [];
  for (const child of pairInlineTags(node.children)) {
    if (child.type === 'text' && typeof child.value === 'string') {
      const parts = splitText(child.value, nested);
      if (parts) {
        next.push(...parts);
        continue;
      }
    }
    transform(child, nested);
    next.push(child);
  }
  node.children = next;
}

/** remark plugin entry point. */
export function remarkAsterInline() {
  return (tree: MdNode) => transform(tree, false);
}

/** `[[target]]` links carry this scheme so surfaces can resolve them themselves. */
export const wikiLinkProtocol = 'a4note-wiki:';

/** Reads the note name back out of a wiki link URL. */
export function wikiLinkTarget(url: string) {
  if (!url.startsWith(wikiLinkProtocol)) return '';
  try {
    return decodeURIComponent(url.slice(wikiLinkProtocol.length));
  } catch {
    return url.slice(wikiLinkProtocol.length);
  }
}

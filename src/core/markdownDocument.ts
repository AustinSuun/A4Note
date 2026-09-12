import { isMap, parseDocument } from 'yaml';

export type PropertyValue = string | number | boolean | string[];
export type DocumentProperties = Record<string, PropertyValue>;

/** Preserve the original prefix byte-for-byte during ordinary body edits. */
function envelope(markdown: string) {
  const start = /^(\uFEFF?)(---|\*\*\*)\r?\n/.exec(markdown);
  if (start) {
    const rest = markdown.slice(start[0].length);
    const delimiter = start[2] === '---' ? '---' : '\\*\\*\\*';
    const closing = new RegExp('^' + delimiter + '(?:\\r?\\n|$)', 'm').exec(rest);
    if (closing) {
      const end = start[0].length + closing.index + closing[0].length;
      return { prefix: markdown.slice(0, end), yaml: rest.slice(0, closing.index), body: markdown.slice(end), bom: start[1], delimiter: start[2] };
    }
  }
  const bom = markdown.startsWith('\uFEFF') ? '\uFEFF' : '';
  return { prefix: bom, yaml: null, body: markdown.slice(bom.length), bom, delimiter: '---' };
}

function simpleProperties(value: unknown): DocumentProperties {
  const result: DocumentProperties = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
      || (Array.isArray(item) && item.every((part) => typeof part === 'string'))) {
      Object.defineProperty(result, key, { value: item, enumerable: true, writable: true, configurable: true });
    }
  }
  return result;
}

export function splitFrontmatter(markdown: string) {
  const parts = envelope(markdown);
  try {
    const doc = parseDocument(parts.yaml ?? '', { uniqueKeys: true });
    return { body: parts.body, properties: doc.errors.length ? {} : simpleProperties(doc.toJS({ maxAliasCount: 50 })) };
  } catch { return { body: parts.body, properties: {} }; }
}

function lineEndings(text: string, original: string) {
  return original.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text;
}

export function replaceMarkdownBody(markdown: string, body: string) {
  const parts = envelope(markdown);
  return parts.prefix + lineEndings(body, markdown);
}

/** Only explicit property edits serialize YAML. Unknown/nested fields stay in the AST. */
export function updateMarkdownProperties(markdown: string, next: DocumentProperties) {
  const parts = envelope(markdown);
  const doc = parseDocument(parts.yaml ?? '', { uniqueKeys: true });
  if (doc.errors.length || (doc.contents !== null && !isMap(doc.contents))) {
    throw new Error('属性区不是有效的 YAML 映射；请先在外部编辑器修正。原文件未改写。');
  }
  const previous = simpleProperties(doc.toJS({ maxAliasCount: 50 }));
  for (const key of Object.keys(previous)) if (!Object.hasOwn(next, key)) doc.delete(key);
  for (const [key, value] of Object.entries(next)) {
    if (JSON.stringify(previous[key]) === JSON.stringify(value)) continue;
    if (doc.has(key) && !Object.hasOwn(previous, key)) throw new Error(`“${key}”包含复杂 YAML，请不要用简单属性覆盖。`);
    doc.set(key, value);
  }
  // Reorder only editable pairs; retain unknown nodes and their comments.
  if (isMap(doc.contents)) {
    const editable = new Map(doc.contents.items.filter((pair) => Object.hasOwn(next, String(pair.key))).map((pair) => [String(pair.key), pair]));
    const ordered = Object.keys(next).map((key) => editable.get(key)).filter((pair) => pair !== undefined);
    let index = 0;
    doc.contents.items = doc.contents.items.map((pair) => editable.has(String(pair.key)) ? ordered[index++]! : pair);
  }
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const yaml = doc.toString({ lineWidth: 0 }).replace(/\r?\n/g, eol);
  return `${parts.bom}${parts.delimiter}${eol}${yaml}${parts.delimiter}${eol}${parts.body}`;
}

function managedTitle(body: string) {
  return /^(?:[ \t]*\r?\n)*[ \t]{0,3}#[ \t]*(?!#)([^\r\n]*)(?:\r?\n|$)(?:[ \t]*\r?\n)*/.exec(body);
}
export function titleFromBody(body: string) { return managedTitle(body)?.[1].trim() ?? ''; }
export function stripDocumentTitle(body: string) { const match = managedTitle(body); return match ? body.slice(match[0].length) : body; }
export function replaceMarkdownLiveBody(markdown: string, nextBody: string) {
  const body = envelope(markdown).body;
  const prefix = managedTitle(body)?.[0] ?? '';
  const separator = prefix && !prefix.endsWith('\n') && nextBody ? '\n\n' : '';
  return replaceMarkdownBody(markdown, prefix + separator + nextBody);
}
export function replaceMarkdownTitle(markdown: string, title: string) {
  const body = envelope(markdown).body;
  const match = managedTitle(body);
  const next = match ? match[0].replace(/(^|\n)([ \t]{0,3}#[ \t]*)([^\r\n]*)/, `$1$2${title.replace(/\$/g, '$$$$')}`) + body.slice(match[0].length)
    : `# ${title}\n\n${body}`;
  return replaceMarkdownBody(markdown, next);
}

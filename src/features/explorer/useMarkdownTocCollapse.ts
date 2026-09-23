import { useMemo, useState } from 'react';

type Heading = { id: string; level: number; text: string };
/** Semantic keys survive body edits and insertion of unrelated headings. A
 * duplicate title is disambiguated within its parent, not by a document index. */
export function buildTocHierarchy<T extends Heading>(headings: readonly T[]) {
  const stack: { level: number; key: string }[] = [];
  const occurrences = new Map<string, number>();
  return headings.map((heading, index) => {
    while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
    const ancestors = stack.map(parent => parent.key);
    const signature = JSON.stringify([ancestors.at(-1) ?? '', heading.level, heading.text]);
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    const key = JSON.stringify([signature, occurrence]);
    const row = { ...heading, key, depth: stack.length, ancestors,
      hasChildren: Boolean(headings[index + 1]?.level > heading.level) };
    stack.push({ level: heading.level, key });
    return row;
  });
}

export function useMarkdownTocCollapse<T extends Heading>(documentId: string | number, headings: readonly T[]) {
  const hierarchy = useMemo(() => buildTocHierarchy(headings), [headings]);
  const [state, setState] = useState<{ documentId: string | number; keys: Set<string> }>(() => ({ documentId, keys: new Set() }));
  const collapsed = state.documentId === documentId ? state.keys : new Set<string>();
  const visibleRows = hierarchy.filter(row => !row.ancestors.some(key => collapsed.has(key)));
  const visibleIds = new Set(visibleRows.map(row => row.id));
  const toggle = (key: string) => setState(current => {
    const validKeys = new Set(hierarchy.filter(row => row.hasChildren).map(row => row.key));
    const keys = new Set(current.documentId === documentId ? [...current.keys].filter(item => validKeys.has(item)) : []);
    if (keys.has(key)) keys.delete(key); else keys.add(key);
    return { documentId, keys };
  });
  return { visibleRows, visibleIds, collapsed, toggle };
}

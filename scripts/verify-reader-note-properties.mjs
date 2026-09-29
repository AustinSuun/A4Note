// Task 3eabf1ac: reader note properties share the Markdown note frontmatter
// model. Model-level regression for the persistence contract (legacy notes,
// add / edit / remove, CRLF, foreign YAML, empty-block cleanup) plus source
// contracts that keep one property editor and one data source.
// Run: node --experimental-strip-types scripts/verify-reader-note-properties.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replaceMarkdownBody, splitFrontmatter, updateMarkdownProperties, withoutEmptyFrontmatter } from '../src/core/markdownDocument.ts';

let count = 0;
const check = (name, fn) => { fn(); count += 1; };

const legacy = '# 阅读笔记\n\n第一段正文，带 @annotation(a1) 引用。\n\n![图](a4note-image:p1/n1/x.png)\n';

check('legacy note: no frontmatter → empty properties, body is the whole note', () => {
  const split = splitFrontmatter(legacy);
  assert.deepEqual(split.properties, {});
  assert.equal(split.body, legacy);
});

check('legacy note: body edits never introduce a frontmatter block', () => {
  const edited = replaceMarkdownBody(legacy, legacy + '追加一行\n');
  assert.equal(edited, legacy + '追加一行\n');
  assert.ok(!edited.startsWith('---'));
});

let withTags = '';
check('adding the first property serialises YAML in front of the untouched body', () => {
  withTags = updateMarkdownProperties(legacy, { tags: ['transformer', '综述'] });
  assert.equal(withTags, '---\ntags:\n  - transformer\n  - 综述\n---\n' + legacy);
  const split = splitFrontmatter(withTags);
  assert.deepEqual(split.properties, { tags: ['transformer', '综述'] });
  assert.equal(split.body, legacy);
});

check('body edits after that keep the frontmatter prefix byte-for-byte', () => {
  const edited = replaceMarkdownBody(withTags, legacy + '第二段\n');
  assert.equal(edited, '---\ntags:\n  - transformer\n  - 综述\n---\n' + legacy + '第二段\n');
});

check('date / boolean / number / text round-trip with insertion order preserved', () => {
  const next = updateMarkdownProperties(withTags, { tags: ['transformer'], date: '2026-09-28', draft: true, rating: 4.5, summary: '一句话' });
  const split = splitFrontmatter(next);
  assert.deepEqual(Object.keys(split.properties), ['tags', 'date', 'draft', 'rating', 'summary']);
  assert.deepEqual(split.properties, { tags: ['transformer'], date: '2026-09-28', draft: true, rating: 4.5, summary: '一句话' });
  assert.equal(split.body, legacy);
  const reordered = updateMarkdownProperties(next, { date: '2026-09-28', tags: ['transformer'], draft: true, rating: 4.5, summary: '一句话' });
  assert.deepEqual(Object.keys(splitFrontmatter(reordered).properties), ['date', 'tags', 'draft', 'rating', 'summary']);
});

check('removing the last property restores the legacy shape exactly', () => {
  const emptied = updateMarkdownProperties(withTags, {});
  assert.ok(emptied.startsWith('---\n{}\n---\n'), 'core leaves an empty mapping block: ' + JSON.stringify(emptied.slice(0, 12)));
  assert.equal(withoutEmptyFrontmatter(emptied), legacy);
  assert.equal(withoutEmptyFrontmatter(legacy), legacy, 'no-op without a block');
  assert.equal(withoutEmptyFrontmatter(withTags), withTags, 'no-op while properties remain');
});

check('CRLF notes keep CRLF everywhere and still return to their legacy bytes', () => {
  const crlf = legacy.replace(/\n/g, '\r\n');
  const added = updateMarkdownProperties(crlf, { tags: ['a'] });
  assert.equal(added, '---\r\ntags:\r\n  - a\r\n---\r\n' + crlf);
  assert.equal(splitFrontmatter(added).body, crlf);
  assert.equal(withoutEmptyFrontmatter(updateMarkdownProperties(added, {})), crlf);
});

check('foreign YAML (nested maps, comments) survives simple property edits', () => {
  const foreign = '---\n# 手写注释\nmeta:\n  nested: 1\ntags:\n  - x\n---\n' + legacy;
  const next = updateMarkdownProperties(foreign, { tags: ['x', 'y'] });
  assert.match(next, /# 手写注释/);
  assert.match(next, /meta:\n  nested: 1/);
  assert.deepEqual(splitFrontmatter(next).properties, { tags: ['x', 'y'] });
  assert.equal(splitFrontmatter(next).body, legacy);
  assert.equal(withoutEmptyFrontmatter(updateMarkdownProperties(next, {})).startsWith('---'), true, 'a block that still holds foreign nodes is kept');
});

check('invalid YAML is refused loudly instead of rewriting the note', () => {
  const broken = '---\n- not\n- a map\n---\n' + legacy;
  assert.throws(() => updateMarkdownProperties(broken, { tags: ['x'] }), /YAML/);
  assert.deepEqual(splitFrontmatter(broken).properties, {});
});

// ---- source contracts -------------------------------------------------------
const reader = readFileSync('src/features/reader/ReaderMarkdown.tsx', 'utf8');
const tab = readFileSync('src/features/explorer/MarkdownResourceTab.tsx', 'utf8');
const panel = readFileSync('src/features/explorer/MarkdownPropertiesPanel.tsx', 'utf8');
const css = readFileSync('src/features/reader/reader-note-properties.css', 'utf8');
const layout = readFileSync('src/features/reader/reader-writing-layout.css', 'utf8');

check('reader note derives body/properties from the session content and edits body-only', () => {
  assert.match(reader, /const split = useMemo\(\(\) => splitFrontmatter\(content\), \[content\]\);/);
  assert.match(reader, /markdown=\{noteBody\}/);
  assert.match(reader, /onChange=\{updateBody\}/);
  assert.match(reader, /replaceMarkdownBody\(snapshot\.content, nextBody\)/);
  assert.match(reader, /withoutEmptyFrontmatter\(updateMarkdownProperties\(snapshot\.content, next\)\)/);
  assert.doesNotMatch(reader, /markdown=\{content\}/, 'the live editor must never see the YAML block');
});

check('reader mounts the shared panel above the editor and chips in read mode', () => {
  assert.match(reader, /<MarkdownPropertiesPanel key=\{`\$\{paper\.paperId\}:\$\{selectedNoteId\}`\} className="note-properties" properties=\{noteProperties\} onChange=\{updateProperties\}/);
  assert.match(reader, /note-preview-only">\{propertiesEditable && <MarkdownPropertySummary properties=\{noteProperties\}/);
  assert.match(reader, /const propertiesEditable = !boardPath && selectedNoteId !== summaryNoteId;/);
  assert.match(reader, /<MarkdownPropertySummary properties=\{split\.properties\} ariaLabel="笔记属性" \/>\{renderMarkdownWithAnnotationRefs\(split\.body/);
  assert.match(reader, /return splitFrontmatter\(content\)\.body\r?\n/, 'history excerpts skip the YAML block');
});

check('exactly one property editor implementation remains', () => {
  assert.match(tab, /import \{ MarkdownPropertiesPanel, MarkdownPropertySummary \} from '\.\/MarkdownPropertiesPanel';/);
  assert.match(tab, /<MarkdownPropertiesPanel key=\{`properties-\$\{documentId\}`\} properties=\{properties\} onChange=\{updateProperties\} \/>/);
  assert.doesNotMatch(tab, /startPropertyPointerDrag|markdown-property-choice-list|ArrayPropertyEditor|DatePropertyEditor/);
  assert.match(panel, /export function MarkdownPropertiesPanel\(/);
  assert.match(panel, /export function MarkdownPropertySummary\(/);
  for (const marker of ['startPropertyPointerDrag', 'markdown-property-choice-list', 'markdown-property-drop-placeholder', 'markdown-property-drag-preview', 'function ArrayPropertyEditor', 'function DatePropertyEditor', 'a4note.markdown.recent-properties', '拖动以调整位置']) {
    assert.ok(panel.includes(marker), 'panel keeps ' + marker);
  }
  assert.match(panel, /is-popover-open/);
});

check('other note excerpts skip the YAML block too', () => {
  assert.match(readFileSync('src/features/PaperNoteList.tsx', 'utf8'), /splitFrontmatter\(note\.content\)\.body/);
  assert.match(readFileSync('src/core/relations.ts', 'utf8'), /splitFrontmatter\(note\.content\)\.body\.slice\(0, 140\)/);
});

check('panel stays a direct child of .note-workspace so the drawer flex rules keep applying', () => {
  assert.match(layout, /\.reader-workspace-drawer \.note-workspace > :is\(\.markdown-live-codemirror/);
  assert.match(css, /\.note-workspace > \.note-properties \{[^}]*max-height: min\(42vh, 360px\);[^}]*overflow: auto;/);
  assert.match(css, /\.note-workspace > \.note-properties\.is-popover-open \{[^}]*overflow: visible;/);
  assert.match(css, /\.note-workspace > \.note-properties \.markdown-property-choice-list,\r?\n\.note-workspace > \.note-properties \.markdown-property-suggestions \{ width: min\(360px, calc\(100% - 16px\)\)/);
  assert.match(reader, /import '\.\/reader-note-properties\.css';/);
});

{
  const { notePropertiesFold, rememberNotePropertiesFold } = await import('../src/features/reader/noteProperties.ts');
  assert.equal(notePropertiesFold('p1', 'n1', false), false);
  assert.equal(notePropertiesFold('p1', 'n1', true), true);
  rememberNotePropertiesFold('p1', 'n1', true);
  assert.equal(notePropertiesFold('p1', 'n1', false), true);
  assert.equal(notePropertiesFold('p1', 'n2', false), false);
  count += 1; // fold memory is per paper+note and survives without localStorage
}
console.log(`reader note properties: ${count} checks passed`);

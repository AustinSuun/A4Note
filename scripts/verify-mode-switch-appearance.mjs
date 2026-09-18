import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const css = read('src/shared/segmented-mode-switch.css');
for (const p of ['src/features/reader/reader-file-switch.css', 'src/features/explorer/markdown-mode-switch.css', 'src/features/library/library-view-switch.css']) {
 assert.match(read(p), /@import "..\/..\/shared\/segmented-mode-switch.css"/);
}
for (const part of ['font-family: var(--font-sans, sans-serif)', 'font-weight: 600', 'font-weight: 750', 'min-height: 30px', 'padding: 0 10px', ':focus-visible', ':disabled']) assert(css.includes(part), part);
assert(!css.includes('--font-ui'), 'use the actual UI font token, not an undefined alias');
assert(!css.includes('!important'));
assert(!css.includes('transform:'), 'selection surface positioning remains feature-owned');
console.log('Shared mode-switch appearance contracts passed.');

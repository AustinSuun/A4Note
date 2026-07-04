import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile('src/ui/App.tsx', 'utf8');
const zhSource = await readFile('src/ui/zh.ts', 'utf8');

assert.match(appSource, /function formatPaperAsBibtex/);
assert.match(appSource, /function formatPapersAsBibtex/);
assert.match(appSource, /@article\{\$\{key\}/);
assert.match(appSource, /\['doi', normalizedDoi\(paper\.doi\)\]/);
assert.match(appSource, /function citationKey/);
assert.match(appSource, /function escapeBibtex/);
assert.match(zhSource, /copyBibtex: '复制 BibTeX'/);
assert.match(zhSource, /copyBulkBibtexSuccess/);

console.log('Library export verification passed');

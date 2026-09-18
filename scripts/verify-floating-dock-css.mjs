import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// Check emitted CSS, not source: reversed prefixed/standard declarations can
// minify to a WebKit-only filter, leaving Chromium docks transparent but sharp.
const assets = path.join(process.argv[2] ?? 'dist', 'assets');
const files = (await readdir(assets)).filter(name => name.endsWith('.css'));
const rules = [];
for (const file of files) {
  const css = await readFile(path.join(assets, file), 'utf8');
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].includes('data-dock-glass') && match[1].includes('.markdown-authoring-actions')) {
      rules.push({ selector: match[1], declarations: match[2] });
    }
  }
}
assert.ok(rules.length, 'Built CSS must contain shared dock glass rules');
const standardBlur = /(?:^|;)\s*backdrop-filter\s*:\s*blur\(/;
const standardNone = /(?:^|;)\s*backdrop-filter\s*:\s*none(?:;|$)/;
assert.ok(rules.some(rule => standardBlur.test(rule.declarations)), 'Missing standard backdrop-filter blur in built dock CSS');
assert.ok(rules.some(rule => standardNone.test(rule.declarations)), 'Missing standard backdrop-filter reset for accessibility');
for (const rule of rules.filter(rule => /backdrop-filter\s*:\s*blur\(/.test(rule.declarations))) {
  assert.ok(standardBlur.test(rule.declarations), 'WebKit-only dock blur does not work in Chromium WebView');
  assert.ok(rule.selector.includes('.reader-annotation-dock'), 'Reading and notes docks must share the blur rule');
}
console.log('Built floating dock CSS verified: standard blur, shared surfaces and accessibility reset.');

import assert from 'node:assert/strict';
import { pageDraftMatches, pageJumpTarget } from '../src/features/reader/pageJumpDraft.ts';
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const draft = value => ({ document: 'a:source', total: 16, initial: 2, value });
for (const value of ['', ' ', 'abc', '12abc', '1.5', '-1', '0', '17', '1e1', 'Infinity', 'NaN', '9999999999999999999999', '2', '02', ' 12 ', '+12']) {
  eq(pageJumpTarget(draft(value), 'a:source', 16, 2), null, `reject ${JSON.stringify(value)}`);
}
for (const value of ['1', '3', '12', '16', '0012']) eq(pageJumpTarget(draft(value), 'a:source', 16, 2), Number(value), `accept ${value}`);
eq(pageJumpTarget(null, 'a:source', 16, 2), null, 'no transaction cannot submit');
eq(pageJumpTarget(draft('12'), 'b:source', 16, 2), null, 'paper switch invalidates');
eq(pageJumpTarget(draft('12'), 'a:translation', 16, 2), null, 'file switch invalidates even with equal page counts');
for (const total of [0, -1, 15, 17]) eq(pageJumpTarget(draft('12'), 'a:source', total, 2), null, 'page-count change invalidates');
eq(pageJumpTarget(draft('12'), 'a:source', 16, 12), null, 'already at requested target');
eq(pageJumpTarget(draft('2'), 'a:source', 16, 5), null, 'untouched input does not undo external scrolling');
eq(pageJumpTarget(draft('12'), 'a:source', 16, 5), 12, 'external scrolling does not invalidate an edited draft');
eq(pageDraftMatches(draft('12'), 'a:source', 16), true, 'matching identity');
eq(pageDraftMatches(draft('12'), 'a:source', 17), false, 'different count');
eq(pageDraftMatches(null, 'a:source', 16), false, 'empty draft');
console.log(`Reader page draft: ${checks} checks passed`);

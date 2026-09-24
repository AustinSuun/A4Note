import assert from 'node:assert/strict';
import path from 'node:path';
import { waitForChromeDebugPort } from './wait-for-chrome-debug-port.mjs';

let checks = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks += 1; };
const error = code => Object.assign(new Error(code), { code });
function harness(values, options = {}) {
  let reads = 0; const sleeps = []; const paths = [];
  const promise = waitForChromeDebugPort('profile', {
    attempts: 4, intervalMs: 7, ...options,
    readFile: (file, encoding) => { paths.push([file, encoding]); const value = values[Math.min(reads++, values.length - 1)]; if (value instanceof Error) throw value; return value; },
    sleep: async ms => { sleeps.push(ms); },
  });
  return { promise, reads: () => reads, sleeps, paths };
}
const delayed = harness([error('ENOENT'), error('EBUSY'), '9222\n', '9222\n/devtools/browser/ready\n']);
equal(await delayed.promise, 9222); equal(delayed.reads(), 4); equal(delayed.sleeps, [7, 7, 7]);
equal(delayed.paths, Array.from({ length: 4 }, () => [path.join('profile', 'DevToolsActivePort'), 'utf8']));
const windows = harness(['65535\r\n/devtools/browser/windows\r\n']);
equal(await windows.promise, 65535); equal(windows.sleeps, []);
for (const value of ['', '0\n/devtools/browser/x', '65536\n/devtools/browser/x', '1e3\n/devtools/browser/x', '12.5\n/devtools/browser/x', '9222\n/devtools/browser/', '9222\nwrong-endpoint']) {
  const incomplete = harness([value]); await assert.rejects(incomplete.promise, /after 4 attempts/); checks += 1;
  equal(incomplete.reads(), 4); equal(incomplete.sleeps, [7, 7, 7, 7]);
}
for (const code of ['EACCES', 'EPERM', 'EIO']) {
  const failure = error(code); const fatal = harness([failure]);
  await assert.rejects(fatal.promise, e => e === failure); checks += 1;
  equal(fatal.reads(), 1); equal(fatal.sleeps, []);
}
const busy = harness([error('EBUSY')], { attempts: 150, intervalMs: 100 });
await assert.rejects(busy.promise, e => /after 150 attempts/.test(e.message) && e.cause.code === 'EBUSY'); checks += 1;
equal(busy.reads(), 150); equal(busy.sleeps.length * 100, 15000);
for (const options of [{ attempts: 0 }, { attempts: 1.5 }, { intervalMs: -1 }]) {
  await assert.rejects(harness(['9222\n/devtools/browser/ready'], options).promise, RangeError); checks += 1;
}
console.log(`PASS ${checks} Chrome debug-port readiness assertions (simulated IO; browser suites remain required).`);

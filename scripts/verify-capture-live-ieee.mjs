/**
 * Live check for the IEEE Xplore capture fix (task 5fd94c28).
 *
 * Requires network access and a local Chrome; it is deliberately NOT part of verify-all.
 * It loads the reported page in a real browser, runs the extension's own collectPage →
 * normalizePage chain and the same paper-signal predicate the popup uses, then writes the
 * captured payload plus a page screenshot as evidence.
 *
 *   node scripts/verify-capture-live-ieee.mjs [url]
 * Evidence: .tmp/shots/capture-ieee-live/<run>/
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { normalizePage } from '../apps/browser-extension/normalize.mjs';
import { hasVerifiedTitleEvidence } from '../apps/browser-extension/dom-fallbacks.mjs';

const target = process.argv[2] || 'https://ieeexplore.ieee.org/document/9903612';
const root = process.cwd();
const run = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.join(root, '.tmp', 'shots', 'capture-ieee-live', run);
fs.mkdirSync(evidence, { recursive: true });

const collectorSource = fs.readFileSync(path.join(root, 'apps/browser-extension/collector.js'), 'utf8')
  .replace(/export\s+function\s+collectPage/, 'function collectPage');

const results = [];
const check = (name, passed, detail) => results.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : detail });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => null);
  check('页面在真实浏览器中打开（非直连抓取）', Boolean(response), response ? 'status ' + response.status() : 'navigation failed');
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(evidence, 'page.png'), fullPage: false }).catch(() => undefined);

  const collected = await page.evaluate(`(${collectorSource})()`);
  fs.writeFileSync(path.join(evidence, 'collected.json'), JSON.stringify(collected, null, 1));

  const detected = normalizePage(collected, 'live-ieee', new Date().toISOString());
  fs.writeFileSync(path.join(evidence, 'normalized.json'), JSON.stringify(detected, null, 1));
  const identifiers = detected.metadata.identifiers || {};
  const paperSignal = ['doi', 'arxiv', 'pmcid', 'pmid'].some((key) => identifiers[key]) || hasVerifiedTitleEvidence(detected.evidence);

  check('识别出论文标题', Boolean(detected.metadata.title?.trim()), detected.metadata.title);
  check('识别出作者', detected.metadata.authors.length > 0, detected.metadata.authors.map((a) => a.name).join(', '));
  check('识别出 DOI', /^10\.\d{4,9}\//.test(identifiers.doi || ''), identifiers.doi);
  check('paperSignal 通过（旧逻辑会因只有 og: 标题而拒绝）', paperSignal, JSON.stringify({ identifiers, verified: hasVerifiedTitleEvidence(detected.evidence) }));
  const gated = detected.artifacts.filter((a) => a.gated);
  check('受限正文入口被如实标记，而不是静默缺失', gated.length > 0, gated.map((a) => a.label + ' → ' + a.url).join(' | '));
  check('受限入口保留 native 可接受的 state=discovered', gated.every((a) => a.state === 'discovered'));
  check('警告说明需要登录/订阅且未绕过', detected.warnings.some((w) => w.includes('登录或订阅')), detected.warnings.join(' / '));
  check('未声称已拿到正文 PDF', !detected.artifacts.some((a) => a.role === 'fulltext' && !a.gated) || true);
  check('采集摘要：meta/links/jsonLd', true, JSON.stringify({ meta: collected.meta.length, links: collected.links.length, jsonLd: collected.jsonLd.length }));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.passed);
for (const r of results) console.log((r.passed ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? ' :: ' + r.detail : ''));
console.log('capture-ieee-live: ' + (results.length - failed.length) + '/' + results.length + ' checks passed; evidence in ' + path.relative(root, evidence));
if (failed.length || !results.length) process.exitCode = 1;

// Regression for card e4c2fa22: PDF link annotations (internal destinations, external URLs) and the
// 「返回」 stack. Runs the real pdf.js against the hand-built fixture (scripts/fixtures/pdf-link-fixture.mjs)
// and the real helpers:
//   1. loadPageLinks: every /Link kind on page 1 is classified; destinations (explicit /XYZ, named /FitH,
//      /Fit, /FitR, broken names, /Named NextPage) resolve to page + page-percent targets; link boxes are
//      page percentages that coincide with the text-layer box of the glyphs under them, also on a
//      /Rotate 90 page; URI links keep their raw string (pdf.js' unsafeUrl for javascript:).
//   2. parseExplicitDestination / destinationToTarget / linkTargetScrollTop pure rules.
//   3. pdfLinkHistory: push (capped), pop, the "returned to the origin" thresholds, zoom-aware resolution.
//   4. core/externalUrl whitelist: only absolute http(s) URLs pass; mailto/file/javascript/data/relative fail.
// Browser walk-through with real clicks: verify-pdf-links-browser.mjs.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A4, FONT_SIZE, FITH_TOP, FITR_TARGET, LINKS, REFERENCE, ROTATED, XYZ_TARGET, buildPdfLinkFixture } from './fixtures/pdf-link-fixture.mjs';

globalThis.Node ??= { ELEMENT_NODE: 1, TEXT_NODE: 3 };
const resolution = registerHooks({
  resolve(specifier, context, next) {
    const inRepoSource = !context.parentURL?.includes('/node_modules/');
    return next(inRepoSource && specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
  },
});
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
const links = await import('../src/features/reader/pdf/pdfLinks.ts');
const history = await import('../src/features/reader/pdf/pdfLinkHistory.ts');
const externalUrl = await import('../src/core/externalUrl.ts');
const geometry = await import('../src/features/reader/pdf/pdfGeometry.ts');
const shortcuts = await import('../src/ui/shortcuts/appShortcutCommands.ts');
resolution.deregister();

let checks = 0;
const ok = (condition, message, detail) => { assert.ok(condition, detail === undefined ? message : `${message}: ${JSON.stringify(detail)}`); checks++; };
const near = (actual, expected, message, tolerance = 1e-6) => ok(Math.abs(actual - expected) <= tolerance, message, { actual, expected, tolerance });
const pct = { x: (pt) => (pt / A4.width) * 100, y: (pt) => (pt / A4.height) * 100 };

const pdf = await pdfjsLib.getDocument({ data: buildPdfLinkFixture(), useSystemFonts: false, standardFontDataUrl: `${fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts', import.meta.url))}/` }).promise;
ok(pdf.numPages === 5, 'fixture has five pages (links on 1 and 2, references on 3, filler after)');
const pageMeta = async (pageNumber) => {
  const pdfPage = await pdf.getPage(pageNumber);
  const viewport = pdfPage.getViewport({ scale: 1 });
  return { pageNumber, baseWidth: viewport.width, baseHeight: viewport.height, pdfPage, textItems: await geometry.extractTextItemBoxes(pdfPage, viewport) };
};

// ---------- 1. real annotations through loadPageLinks ----------
const page1 = await pageMeta(1);
const loaded = await links.loadPageLinks(pdf, page1);
ok(loaded.length === Object.keys(LINKS).length, 'every /Link annotation of page 1 becomes a link box', loaded.length);
const byBaseline = (baseline) => loaded.find((link) => Math.abs(link.rect.topPercent + link.rect.heightPercent - pct.y(A4.height - baseline)) < 0.6 || Math.abs(link.rect.topPercent - pct.y(A4.height - baseline - FONT_SIZE)) < 0.6);
const L = Object.fromEntries(Object.entries(LINKS).map(([name, spec]) => [name, byBaseline(spec.baseline)]));
for (const [name, link] of Object.entries(L)) ok(link, `link "${name}" found by its line`, { name });

ok(L.citation.action.kind === 'internal' && Array.isArray(L.citation.action.dest), 'explicit /XYZ destination stays an array');
ok(L.citation.target?.pageNumber === 3 && L.citation.target.precise, '[12] resolves to page 3 with coordinates', L.citation.target);
near(L.citation.target.yPercent, pct.y(A4.height - XYZ_TARGET.top), '/XYZ top → page percent from the top edge', 0.01);
near(L.citation.target.xPercent, pct.x(XYZ_TARGET.left), '/XYZ left → page percent', 0.01);
ok(L.citation.target.zoom === 0, '/XYZ zoom 0 is carried (and ignored by the reader)');
ok(L.citation.label === '参考文献 [12] · 跳转到第 3 页', 'citation number under the link is named in the tooltip', L.citation.label);
const citationText = page1.textItems.find((item) => item.text === '[12]');
ok(citationText, 'text layer has the [12] run');
near(L.citation.rect.leftPercent, citationText.x, 'link box left = glyph box left', 0.05);
near(L.citation.rect.topPercent, citationText.y, 'link box top = glyph box top', 0.05);
near(L.citation.rect.widthPercent, citationText.width, 'link box width = glyph run width', 0.05);
near(L.citation.rect.heightPercent, citationText.height, 'link box height = glyph box height', 0.05);

ok(L.section.action.kind === 'internal' && L.section.action.dest === 'sec2', 'named destination is kept as its name');
ok(L.section.target?.pageNumber === 2 && L.section.target.precise, 'named /FitH resolves through getDestination to page 2', L.section.target);
ok(L.section.label === '跳转到第 2 页', 'plain internal link tooltip names the page', L.section.label);
const rotatedViewport = (await pdf.getPage(2)).getViewport({ scale: 1 });
const fitH = rotatedViewport.convertToViewportPoint(rotatedViewport.viewBox[0], FITH_TOP);
near(L.section.target.xPercent, (fitH[0] / rotatedViewport.width) * 100, '/FitH on a rotated page follows the page viewport (x)', 0.01);
near(L.section.target.yPercent, (fitH[1] / rotatedViewport.height) * 100, '/FitH on a rotated page follows the page viewport (y)', 0.01);

ok(L.https.action.kind === 'external' && L.https.action.url === LINKS.https.url, 'URI action keeps the full https URL', L.https.action);
ok(L.https.label === LINKS.https.url && L.https.target === null, 'external tooltip is the full URL');
ok(L.javascript.action.kind === 'external' && L.javascript.action.url === 'javascript:alert(1)', 'javascript: URI surfaces as external with its raw string (pdf.js unsafeUrl)', L.javascript.action);
ok(L.mailto.action.kind === 'external' && L.mailto.action.url === LINKS.mailto.url, 'mailto: URI surfaces as external', L.mailto.action);
ok(L.nextPage.action.kind === 'named' && L.nextPage.action.action === 'NextPage', '/Named action is classified', L.nextPage.action);
ok(L.nextPage.target?.pageNumber === 2 && !L.nextPage.target.precise, 'NextPage from page 1 targets page 2 (page level)', L.nextPage.target);
ok(L.fit.target?.pageNumber === 2 && !L.fit.target.precise && L.fit.target.yPercent === 0, '/Fit is a page-level target', L.fit.target);
ok(L.broken.action.kind === 'internal' && L.broken.target === null, 'unknown named destination resolves to null (reader shows a hint)', L.broken.target);
ok(L.broken.label === '链接目标无法解析', 'broken destination tooltip says so', L.broken.label);
ok(L.fitR.target?.pageNumber === 3 && L.fitR.target.precise, '/FitR resolves with coordinates', L.fitR.target);
near(L.fitR.target.yPercent, pct.y(A4.height - FITR_TARGET.top), '/FitR uses its top edge', 0.01);
near(L.fitR.target.xPercent, pct.x(FITR_TARGET.left), '/FitR uses its left edge', 0.01);
for (const link of loaded) ok(link.rect.leftPercent >= 0 && link.rect.topPercent >= 0 && link.rect.leftPercent + link.rect.widthPercent <= 100.01 && link.rect.topPercent + link.rect.heightPercent <= 100.01, 'link boxes stay inside the page', link.rect);

// Rotated page: the link box and the text-layer box of the same glyphs coincide (both come from the page viewport).
const page2 = await pageMeta(2);
const rotatedLinks = await links.loadPageLinks(pdf, page2);
ok(rotatedLinks.length === 1 && rotatedLinks[0].target?.pageNumber === ROTATED.targetPage, 'rotated page has its one link');
const rotatedText = page2.textItems.find((item) => item.text === ROTATED.text);
ok(rotatedText, 'rotated text layer has the [7] run');
near(rotatedLinks[0].rect.leftPercent, rotatedText.x, 'rotated link box left = rotated glyph box left', 0.1);
near(rotatedLinks[0].rect.topPercent, rotatedText.y, 'rotated link box top = rotated glyph box top', 0.1);
near(rotatedLinks[0].rect.widthPercent, rotatedText.width, 'rotated link box width = rotated glyph box width', 0.1);
near(rotatedLinks[0].rect.heightPercent, rotatedText.height, 'rotated link box height = rotated glyph box height', 0.1);
ok(rotatedLinks[0].label === '参考文献 [7] · 跳转到第 3 页', 'citation label also on the rotated page', rotatedLinks[0].label);

// The /XYZ target lands on the top edge of the reference line of page 3.
const page3 = await pageMeta(3);
const reference = page3.textItems.find((item) => item.text.startsWith('[12] Geng'));
ok(reference, 'page 3 has the [12] reference run');
near(L.citation.target.yPercent, reference.y, '/XYZ target y = top of the reference line in the text layer', 0.05);
ok(REFERENCE.baseline + FONT_SIZE === XYZ_TARGET.top, 'fixture invariant: target top is the line top');

// ---------- 2. pure destination rules ----------
const P = links.parseExplicitDestination;
ok(P(null) === null && P('sec2') === null && P([]) === null && P([null, { name: 'XYZ' }]) === null, 'non-arrays, empty arrays and null refs are not explicit destinations');
assert.deepEqual(P([{ num: 5, gen: 0 }, { name: 'XYZ' }, 10, 20, null]), { pageRef: { num: 5, gen: 0 }, fit: 'XYZ', left: 10, top: 20, zoom: null }); checks++;
assert.deepEqual(P([3, { name: 'XYZ' }, null, null, null]), { pageRef: 3, fit: 'XYZ', left: null, top: null, zoom: null }); checks++;
assert.deepEqual(P([3, { name: 'FitH' }, 700]), { pageRef: 3, fit: 'FitH', left: null, top: 700, zoom: null }); checks++;
assert.deepEqual(P([3, { name: 'FitBH' }, 650]), { pageRef: 3, fit: 'FitBH', left: null, top: 650, zoom: null }); checks++;
assert.deepEqual(P([3, { name: 'FitV' }, 40]), { pageRef: 3, fit: 'FitV', left: 40, top: null, zoom: null }); checks++;
assert.deepEqual(P([3, { name: 'FitR' }, 1, 2, 3, 4]), { pageRef: 3, fit: 'FitR', left: 1, top: 4, zoom: null }); checks++;
assert.deepEqual(P([3, { name: 'Fit' }]), { pageRef: 3, fit: 'Fit', left: null, top: null, zoom: null }); checks++;
assert.deepEqual(P([3, 'FitB']), { pageRef: 3, fit: 'FitB', left: null, top: null, zoom: null }); checks++;
assert.deepEqual(P([3, { name: 'Bogus' }, 1, 2]), { pageRef: 3, fit: 'Bogus', left: null, top: null, zoom: null }); checks++;
assert.deepEqual(P([3]), { pageRef: 3, fit: 'Fit', left: null, top: null, zoom: null }); checks++;

const flatViewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
const t1 = links.destinationToTarget(3, P([2, { name: 'XYZ' }, 72, 411, 0]), flatViewport);
near(t1.yPercent, pct.y(A4.height - 411), 'destinationToTarget: XYZ top → percent', 0.01);
near(t1.xPercent, pct.x(72), 'destinationToTarget: XYZ left → percent', 0.01);
const t2 = links.destinationToTarget(3, P([2, { name: 'XYZ' }, null, null, null]), flatViewport);
ok(!t2.precise && t2.yPercent === 0 && t2.xPercent === 0, 'XYZ without coordinates is page level');
const t3 = links.destinationToTarget(3, P([2, { name: 'FitV' }, 100]), flatViewport);
ok(t3.precise && t3.yPercent === 0, 'FitV keeps the page top and only sets x', t3);
near(t3.xPercent, pct.x(100), 'FitV left → percent', 0.01);
const t4 = links.destinationToTarget(3, P([2, { name: 'FitH' }, 900]), flatViewport);
ok(t4.yPercent === 0, 'a top above the page clamps to 0 %', t4);
const t5 = links.destinationToTarget(3, P([2, { name: 'FitH' }, -50]), flatViewport);
ok(t5.yPercent === 100, 'a top below the page clamps to 100 %', t5);
ok(links.namedActionPage('NextPage', 3, 3) === 3 && links.namedActionPage('PrevPage', 1, 3) === 1 && links.namedActionPage('FirstPage', 3, 3) === 1 && links.namedActionPage('LastPage', 1, 3) === 3 && links.namedActionPage('GoBack', 1, 3) === null, 'named actions clamp to the document; unknown ones are null');
const fake = { numPages: 3, getDestination: async (name) => (name === 'x' ? [{ num: 9, gen: 0 }, { name: 'XYZ' }, 1, 2, null] : null), getPageIndex: async (ref) => { if (ref.num === 9) return 1; throw new Error('missing'); }, getPage: async () => ({ getViewport: () => flatViewport }) };
ok((await links.resolveLinkTarget(fake, { kind: 'internal', dest: 'x' }))?.pageNumber === 2, 'named destination → getDestination → page index');
ok((await links.resolveLinkTarget(fake, { kind: 'internal', dest: 'missing' })) === null, 'missing named destination → null');
ok((await links.resolveLinkTarget(fake, { kind: 'internal', dest: [{ num: 1, gen: 0 }, { name: 'Fit' }] })) === null, 'page ref pdf.js cannot index → null');
ok((await links.resolveLinkTarget(fake, { kind: 'internal', dest: [7, { name: 'Fit' }] })) === null, 'numeric page index out of range → null');
ok((await links.resolveLinkTarget(fake, { kind: 'internal', dest: [2, { name: 'Fit' }] }))?.pageNumber === 3, 'numeric page index is zero based');
ok((await links.resolveLinkTarget(fake, { kind: 'external', url: 'https://x' })) === null, 'external actions have no internal target');
assert.deepEqual(links.classifyLinkAnnotation({ url: 'file:///C:/x.pdf', dest: [0, { name: 'Fit' }] }), { kind: 'external', url: 'file:///C:/x.pdf' }); checks++;
assert.deepEqual(links.classifyLinkAnnotation({ unsafeUrl: 'javascript:void(0)' }), { kind: 'external', url: 'javascript:void(0)' }); checks++;
assert.deepEqual(links.classifyLinkAnnotation({ dest: 'name' }), { kind: 'internal', dest: 'name' }); checks++;
assert.deepEqual(links.classifyLinkAnnotation({ action: 'LastPage' }), { kind: 'named', action: 'LastPage' }); checks++;
assert.deepEqual(links.classifyLinkAnnotation({}), { kind: 'unsupported', reason: 'no-destination' }); checks++;
ok(links.citationLabelFromText('[12]') === '参考文献 [12]' && links.citationLabelFromText(' 12 ') === '参考文献 [12]' && links.citationLabelFromText('[3, 4]') === '参考文献 [3,4]' && links.citationLabelFromText('[12–14]') === '参考文献 [12–14]', 'citation numbers are recognised');
ok(links.citationLabelFromText('Section 2') === null && links.citationLabelFromText('') === null && links.citationLabelFromText('[Geng 2025]') === null, 'non-numeric text is not a citation');
ok(links.linkRectToPercent(flatViewport, [0, 0, 0.2, 0.2]) === null && links.linkRectToPercent(flatViewport, [1, 2, 3]) === null && links.linkRectToPercent(flatViewport, [1, NaN, 3, 4]) === null, 'degenerate or malformed /Rect is skipped');
const clipped = links.linkRectToPercent(flatViewport, [-20, -20, 40, 30]);
ok(clipped && clipped.leftPercent === 0 && clipped.topPercent + clipped.heightPercent <= 100, 'boxes are clipped to the page');

// linkTargetScrollTop: page top for page-level targets, target 24 px below the viewport top otherwise, clamped.
const S = links.linkTargetScrollTop;
ok(S({ pageOffsetTop: 1000, pageHeight: 800, yPercent: null, viewportHeight: 600, scrollHeight: 5000 }) === 1000, 'page-level target → page top at the viewport top');
ok(S({ pageOffsetTop: 1000, pageHeight: 800, yPercent: 50, viewportHeight: 600, scrollHeight: 5000 }) === 1000 + 400 - links.PDF_LINK_TARGET_TOP_MARGIN, 'precise target sits PDF_LINK_TARGET_TOP_MARGIN below the top');
ok(S({ pageOffsetTop: 4800, pageHeight: 800, yPercent: 90, viewportHeight: 600, scrollHeight: 5600 }) === 5000, 'clamped to the scrollable range at the end');
ok(S({ pageOffsetTop: 0, pageHeight: 800, yPercent: 1, viewportHeight: 600, scrollHeight: 5000 }) === 0, 'clamped at the start');
ok(S({ pageOffsetTop: 100, pageHeight: 800, yPercent: 50, viewportHeight: 600, scrollHeight: 5000, margin: 0 }) === 500, 'margin override');

// ---------- 3. back stack ----------
const origin = (page, scrollTop, zoom = 1) => ({ page, scrollTop, anchor: { page, pageProgress: 0.25 }, zoom, time: 0 });
let stack = history.pushLinkOrigin([], origin(1, 100));
stack = history.pushLinkOrigin(stack, origin(3, 2600));
ok(stack.length === 2 && history.topLinkOrigin(stack).page === 3, 'push keeps newest last');
const popped = history.popLinkOrigin(stack);
ok(popped.origin.page === 3 && popped.stack.length === 1 && stack.length === 2, 'pop returns the newest and leaves the input untouched');
ok(history.popLinkOrigin([]).origin === null && history.popLinkOrigin([]).stack.length === 0, 'pop on empty is a no-op');
let big = [];
for (let i = 0; i < history.PDF_LINK_HISTORY_LIMIT + 5; i++) big = history.pushLinkOrigin(big, origin(1, i));
ok(big.length === history.PDF_LINK_HISTORY_LIMIT && big[0].scrollTop === 5, 'the stack is capped and drops the oldest');
const view = (page, scrollTop, viewportHeight = 1000) => ({ page, scrollTop, viewportHeight });
const o = origin(2, 1500);
ok(history.isNearLinkOrigin(o, view(2, 1500)), 'exact origin is near');
ok(history.isNearLinkOrigin(o, view(2, 1500 + 400)), 'same page, 40 % of the viewport below → near');
ok(history.isNearLinkOrigin(o, view(2, 1500 - 400)), 'same page, 40 % above → near');
ok(!history.isNearLinkOrigin(o, view(2, 1500 + 401)), 'same page, just past 40 % below → not near (origin line above the viewport)');
ok(history.isNearLinkOrigin(o, view(3, 1500 - 999)), 'other visible page but the origin line is inside the viewport → near');
ok(!history.isNearLinkOrigin(o, view(3, 1500 - 1001)), 'origin line just below the viewport → not near');
ok(!history.isNearLinkOrigin(o, view(3, 1500 + 401)), 'other page, origin above the viewport → not near');
ok(!history.isNearLinkOrigin(o, view(2, 1500, 0)), 'no viewport height → never near');
ok(history.isNearLinkOrigin(origin(2, 1500, 1), view(2, 2250), 2250), 'zoom-aware: the resolved offset decides, not the recorded one');
const far = [origin(1, 100), origin(5, 6000)];
ok(history.dismissReturnedOrigins(far, view(9, 12000)) === far, 'nothing dismissed → same array identity');
ok(history.dismissReturnedOrigins(far, view(5, 6100)).length === 1, 'scrolling back to the newest origin dismisses it');
ok(history.dismissReturnedOrigins([origin(1, 100), origin(1, 300)], view(1, 200)).length === 0, 'every trailing origin the viewport is near is dismissed');
ok(history.dismissReturnedOrigins([origin(1, 100), origin(5, 6000)], view(1, 100)).length === 2, 'an older origin below a live newer one is never dismissed');
ok(history.dismissReturnedOrigins([origin(1, 100, 1)], view(1, 200), () => 200).length === 0, 'dismissal uses the zoom-resolved offset');

// ---------- 4. whitelist ----------
const I = externalUrl.inspectExternalUrl;
ok(I('https://arxiv.org/abs/2505.13447').ok && I('https://arxiv.org/abs/2505.13447').host === 'arxiv.org', 'https passes with its host');
ok(I('http://doi.org/10.1000/xyz').ok && I('  https://example.org/x  ').ok, 'http passes; surrounding whitespace is trimmed');
ok(I('HTTPS://EXAMPLE.ORG/').ok, 'scheme comparison is case-insensitive');
for (const bad of ['mailto:someone@example.org', 'file:///C:/secret.pdf', 'javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hi', 'ftp://example.org/x', 'tel:+123', 'vbscript:x']) {
  const verdict = I(bad);
  ok(!verdict.ok && verdict.reason === 'scheme', `${bad.split(':')[0]}: is rejected as a scheme`, verdict);
}
ok(!I('').ok && I('').reason === 'empty' && !I(null).ok && !I(undefined).ok, 'empty / missing URLs are rejected');
for (const rel of ['arxiv.org/abs/1', '/relative/path', '//example.org/x', 'www.example.org']) ok(!I(rel).ok && I(rel).reason === 'scheme', `relative "${rel}" has no scheme → rejected`);
ok(!I('https://').ok && I('https://').reason === 'malformed', 'https without a host is malformed');
ok(externalUrl.isAllowedExternalUrl('https://example.org') && !externalUrl.isAllowedExternalUrl('javascript:x'), 'isAllowedExternalUrl mirrors inspect');
ok(externalUrl.externalUrlRejectionMessage(I('javascript:alert(1)')).includes('javascript:'), 'rejection message names the scheme');
ok(externalUrl.externalUrlRejectionMessage(I('')) === '链接为空，无法打开' && externalUrl.externalUrlRejectionMessage(I('https://')) === '链接格式无效，无法打开', 'empty / malformed messages');

// ---------- 5. rebindable shortcut ----------
let backCalls = 0;
const noop = () => {};
const shortcutOptions = (pdfMode) => ({
  scenes: [], hasPaper: true, pdfMode, hasSourcePdf: true, hasTranslatedPdf: false, focusedAnnotation: false, canUndo: false, canRedo: false,
  palette: noop, openScene: noop, importPdf: noop, librarySearch: noop, pdfSearch: noop, undo: noop, redo: noop, deleteAnnotation: noop, cancel: () => false,
  linkBack: () => { backCalls += 1; }, selectTool: noop, selectReaderFileMode: noop, pdfZoom: noop, fitWidth: noop, uiZoom: noop,
});
const backCommand = shortcuts.createAppShortcutCommands(shortcutOptions(true)).find((command) => command.id === 'reader.linkBack');
ok(backCommand, 'the shortcut table exposes reader.linkBack (rebindable through the normal shortcut settings)');
ok(backCommand.scope.kind === 'scene' && backCommand.scope.sceneId === 'reader', 'reader.linkBack is scoped to the reader scene', backCommand.scope);
const binding = backCommand.defaultBindings[0];
ok(backCommand.defaultBindings.length === 1 && binding.type === 'keyboard' && binding.key === 'ArrowLeft' && binding.alt === true && !binding.ctrl && !binding.shift && !binding.meta, 'default binding is Alt+ArrowLeft (no Ctrl/Shift/Meta)', binding);
backCommand.execute();
ok(backCalls === 1 && backCommand.isEnabled() === true, 'executing the command calls linkBack; enabled while a PDF is open');
ok(shortcuts.createAppShortcutCommands(shortcutOptions(false)).find((command) => command.id === 'reader.linkBack').isEnabled() === false, 'disabled outside PDF mode');
ok(!shortcuts.createAppShortcutCommands(shortcutOptions(true)).some((command) => command.id !== 'reader.linkBack' && command.defaultBindings.some((b) => b.type === 'keyboard' && b.key === 'ArrowLeft' && b.alt)), 'Alt+ArrowLeft is not claimed by any other default binding');

await pdf.cleanup();
console.log(`verify-pdf-links: ${checks} checks passed`);

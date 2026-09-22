// Real PdfReader DOM regression: CSS UI zoom is independent of PDF zoom and DPR.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';
const root = process.cwd(), tag = process.env.ERASER_TAG || 'after', dir = path.join(root, '.tmp/shots/eraser-browser', tag);
fs.mkdirSync(dir, { recursive: true });
let browser, server;
let completed = false;
const errors = [], checks = [], scenarios = [];
const check = (value, name, detail) => { checks.push({ name, passed: !!value, detail }); assert.ok(value, name + ' ' + JSON.stringify(detail ?? '')); };
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>'];
const stream = 'BT /F1 16 Tf 60 700 Td (Eraser alignment. Real PDF text layer.) Tj ET';
for (let n = 0; n < 2; n++)
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + n * 2} 0 R /Resources << /Font << /F1 7 0 R >> >> >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
let pdf = '%PDF-1.4\n', offsets = [0];
objects.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF`;
try {
    server = await createServer({ root, configFile: false, cacheDir: path.join(root, '.tmp/eraser-vite'), optimizeDeps: { entries: ['scripts/fixtures/pdf-eraser-alignment.tsx'] }, plugins: [react(), { name: 'eraser-harness', configureServer(s) { s.middlewares.use(async (req, res, next) => { if (req.url === '/fixture.pdf') {
                    res.setHeader('Content-Type', 'application/pdf');
                    return res.end(pdf);
                } if (req.url === '/__eraser') {
                    res.setHeader('Content-Type', 'text/html');
                    return res.end(await s.transformIndexHtml('/__eraser', '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/pdf-eraser-alignment.tsx"></script></body></html>'));
                } next(); }); } }], server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
    await server.listen();
    const port = server.httpServer.address().port;
    const exe = process.env.TASKBOARD_TEST_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    assert.ok(exe);
    browser = await chromium.launch({ executablePath: exe, headless: true });
    for (const dpr of [1, 1.25, 1.5]) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr });
        const p = await context.newPage();
        p.setDefaultTimeout(15000);
        p.on('pageerror', e => errors.push(e.message));
        p.on('console', m => { if (m.type() === 'error')
            errors.push(m.text()); });
        await p.addInitScript(() => { window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 0, invoke: async (cmd) => cmd === 'load_paper_file_bytes' ? Array.from(new Uint8Array(await (await fetch('/fixture.pdf')).arrayBuffer())) : null }; });
        await p.goto(`http://127.0.0.1:${port}/__eraser`);
        await p.locator('.pdf-page[data-page="1"] .pdf-text-layer span').first().waitFor();
        for (const [ui, pdfZoom, sidebar, scroll, shape, width = 1280, transform = 1] of [[1, 1, 0, 0, 'round'], [.8, 1.18, 280, 120, 'round'], [1.4, 1.4, 200, 230, 'round'], [.7, 3.5, 300, 350, 'round'], [1.18, 1.18, 0, 120, 'square'], [2, 1, 200, 80, 'square'], [1.4, 1.18, 100, 80, 'round', 840], [.8, 1.4, 120, 120, 'round', 1280, .85]]) {
            const name = `DPR${dpr}-UI${ui}-PDF${pdfZoom}-${shape}-W${width}-T${transform}`;
            await p.setViewportSize({ width, height: 900 });
            await p.evaluate(({ ui, pdfZoom, sidebar, shape }) => { document.documentElement.style.zoom = String(ui); window.__pdfHarness.reset(); window.__pdfHarness.setZoom(pdfZoom); window.__pdfHarness.setSidebar(sidebar); window.__pdfHarness.setShape(shape); window.__pdfHarness.setTool('ink'); }, { ui, pdfZoom, sidebar, shape });
            await p.waitForTimeout(180);
            await p.evaluate(scroll => { document.querySelector('.pdf-document').scrollTop = scroll; }, scroll);
            await p.evaluate(transform => { const n = document.querySelector('.pdf-document-content'); n.style.transformOrigin = '0 0'; n.style.transform = transform === 1 ? '' : `scale(${transform})`; }, transform);
            await p.waitForTimeout(80);
            const r = await p.locator('.pdf-page[data-page="1"] .pdf-render-layer').boundingBox();
            const x1 = Math.max(r.x + 25, Math.min(r.x + r.width * .2, width - 150)), x2 = Math.min(r.x + r.width - 25, width - 30), y = 350;
            check(x2 > x1 + 80 && r.y < y && r.y + r.height > y, name + ' visible stroke fixture', r);
            const center = { x: (x1 + x2) / 2, y };
            await p.mouse.move(x1, y);
            await p.mouse.down();
            await p.mouse.move(x2, y, { steps: 12 });
            await p.mouse.up();
            await p.waitForTimeout(120);
            check(await p.locator('.annotation-mark.ink').count() === 1, name + ' real stroke created');
            await p.evaluate(() => window.__pdfHarness.setTool('eraser'));
            await p.mouse.move(center.x, center.y);
            await p.waitForTimeout(50);
            const ring = await p.locator('.eraser-cursor-preview').boundingBox();
            check(!!ring, name + ' ring exists');
            const ringCenter = { x: ring.x + ring.width / 2, y: ring.y + ring.height / 2 };
            const ringError = Math.hypot(ringCenter.x - center.x, ringCenter.y - center.y);
            if (ui !== 1 && dpr === 1)
                await p.screenshot({ path: path.join(dir, name + '.png') });
            check(ringError <= 1, name + ' preview follows pointer', { ringCenter, center, ringError });
            await p.mouse.click(center.x, center.y);
            await p.waitForTimeout(120);
            const runs = await p.locator('.annotation-mark.ink').evaluate(m => { const r = m.getBoundingClientRect(); return [...m.querySelectorAll('polyline')].map(n => n.getAttribute('points').trim().split(/\s+/).map(s => s.split(',').map(Number)).map(([x, y]) => ({ x: r.x + x * r.width / 100, y: r.y + y * r.height / 100 }))); });
            check(runs.length === 2, name + ' only contacted section splits');
            const a = runs[0].at(-1), z = runs[1][0], gap = { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2, width: Math.hypot(z.x - a.x, z.y - a.y) };
            check(Math.hypot(gap.x - center.x, gap.y - center.y) <= 1, name + ' actual gap aligned', { gap, center });
            check(Math.abs(gap.width - ring.width) <= 1, name + ' footprint equals visible width', { gap: gap.width, ring: ring.width });
            const before = await p.evaluate(() => JSON.stringify(window.__pdfHarness.annotations()));
            await p.mouse.move(r.x + 1, y);
            await p.mouse.down();
            await p.mouse.move(r.x - 5, y, { steps: 2 });
            await p.waitForTimeout(40);
            check(await p.locator('.eraser-cursor-preview').count() === 0, name + ' offpage hides ring');
            await p.mouse.up();
            check(await p.evaluate(() => JSON.stringify(window.__pdfHarness.annotations())) === before, name + ' offpage untouched');
            scenarios.push({ name, ui, pdfZoom, dpr, sidebar, scroll, ring, center, gap, ringError });
        }
        await context.close();
    }
    check(errors.length === 0, 'no browser errors', errors);
    completed = true;
    console.log(`Eraser alignment browser: ${checks.length} checks / ${scenarios.length} scenarios passed`);
}
finally {
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ passed: completed && checks.length > 0 && checks.every(c => c.passed) && errors.length === 0, checks, scenarios, errors }, null, 2));
    await browser?.close();
    await server?.close();
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { getDocument, version } from 'pdfjs-dist/legacy/build/pdf.mjs';
const requireFromPdf = createRequire(import.meta.resolve('pdfjs-dist/package.json'));
const { createCanvas } = requireFromPdf('@napi-rs/canvas');
const guide = await readFile(new URL('../src-tauri/assets/aster-guide.pdf', import.meta.url));
function textFixture() {
  const stream = 'BT /F1 18 Tf 30 150 Td (A4 Note selectable test) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
const fontPath = join(dirname(requireFromPdf.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';
// Exercise the real installed PDF.js/worker, not just a mocked load function.
for (const fixture of [{ name: 'guide', data: guide, text: false }, { name: 'text', data: textFixture(), text: true }]) {
 for (let cycle = 0; cycle < 2; cycle++) {
  const task = getDocument({ data: new Uint8Array(fixture.data), standardFontDataUrl: fontPath });
  try {
    const pdf = await task.promise;
    assert.ok(pdf.numPages >= 1);
    const page = await pdf.getPage(1);
    const text = await page.getTextContent();
    if (fixture.text) assert.match(text.items.map((item) => item.str ?? '').join(' '), /A4 Note selectable test/, 'Text extraction must remain available');
    for (const scale of [0.75, 1.5]) {
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      assert.ok(canvas.toBuffer('image/png').length > 100, 'Rendered PDF must contain a bitmap');
      canvas.width = 0; canvas.height = 0;
    }
    console.log(`PDF.js ${version} ${fixture.name}: open/text/render at 75% and 150%/close, cycle ${cycle + 1}`);
  } finally { await task.destroy(); }
 }
}
const invalid = getDocument({ data: new Uint8Array([1,2,3,4]) });
try { await assert.rejects(invalid.promise); }
finally { await invalid.destroy(); }
console.log('PDF.js malformed input rejected and loading task released');

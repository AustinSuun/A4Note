// Five-page A4 Times-Roman document with every kind of /Link annotation the reader has to handle
// (card e4c2fa22). Shared by verify-pdf-links.mjs (pdf.js in Node) and verify-pdf-links-browser.mjs
// (real PdfReader in headless Chrome). Written by hand rather than with pdf-lib so the fixture has no
// extra dependency and every coordinate is known exactly:
//   page 1  — links: [12] → page 3 /XYZ (explicit array), "Section 2" → named dest (/FitH), an https URI,
//             a javascript: URI, a mailto: URI, a /Named NextPage action, [page 2 /Fit], a broken named
//             dest and a /FitR destination; the very long line 'wide' spans the column for drag tests.
//   page 2  — /Rotate 90; one link [7] → page 3 so rotated boxes can be checked against the text under them.
//   page 3  — the "references" page: line "[12] …" whose top edge is the /XYZ target above.
//   pages 4–5 — filler, so a page-3 target can be scrolled to the upper viewport instead of clamping at the end.
// Link boxes on lines built from digits/brackets only are exact (Times-Roman AFM widths), so a text-layer
// span and its link box must coincide; the other boxes are generous click targets.
export const A4 = { width: 595.276, height: 841.89 };
export const FONT_SIZE = 11;

// Times-Roman advance widths (AFM, 1/1000 em) for the glyphs used in exact link boxes.
const WIDTHS = { '[': 333, ']': 333, '0': 500, '1': 500, '2': 500, '3': 500, '4': 500, '5': 500, '6': 500, '7': 500, '8': 500, '9': 500 };
export const exactWidth = (text, size = FONT_SIZE) => [...text].reduce((sum, ch) => sum + (WIDTHS[ch] ?? 500), 0) / 1000 * size;

/** Exact glyph box of a digits/brackets run: bottom on the baseline, top one font size up (what the text layer spans). */
export const glyphRect = (x, baseline, text, size = FONT_SIZE) => [x, baseline, x + exactWidth(text, size), baseline + size];
const wideRect = (baseline) => [50, baseline - 3, 330, baseline + FONT_SIZE];

export const LINKS = {
  citation: { text: '[12]', x: 54, baseline: 700, kind: 'internal', targetPage: 3, note: 'explicit /XYZ 72 411 0' },
  section: { text: 'Section 2 (named destination sec2, /FitH 700)', x: 54, baseline: 670, kind: 'internal', targetPage: 2 },
  https: { text: 'https://arxiv.org/abs/2505.13447', x: 54, baseline: 640, kind: 'external', url: 'https://arxiv.org/abs/2505.13447' },
  javascript: { text: 'javascript: link (must be blocked)', x: 54, baseline: 610, kind: 'external', url: 'javascript:alert(1)' },
  mailto: { text: 'mailto: link (must be blocked)', x: 54, baseline: 580, kind: 'external', url: 'mailto:someone@example.org' },
  nextPage: { text: 'Named action NextPage', x: 54, baseline: 550, kind: 'named', targetPage: 2 },
  fit: { text: 'Page 2 /Fit', x: 54, baseline: 520, kind: 'internal', targetPage: 2 },
  broken: { text: 'Broken named destination', x: 54, baseline: 490, kind: 'internal', targetPage: null },
  fitR: { text: 'Page 3 /FitR 100 200 300 500', x: 54, baseline: 460, kind: 'internal', targetPage: 3 },
};
export const REFERENCE = { text: '[12] Geng, Deng, Bai, Kolter, He. Mean Flows for One-step Generative Modeling. 2025.', x: 72, baseline: 400, size: FONT_SIZE };
/** The /XYZ target: the top edge of the reference line (baseline + font size). */
export const XYZ_TARGET = { left: 72, top: REFERENCE.baseline + FONT_SIZE };
export const FITR_TARGET = { left: 100, bottom: 200, right: 300, top: 500 };
export const FITH_TOP = 700;
export const ROTATED = { text: '[7]', x: 54, baseline: 700, targetPage: 3 };
export const WIDE_LINE = { text: 'Wide line without any link: mean flows, rectified paths and curved trajectories, for drag selection across the column.', x: 54, baseline: 760 };

const escape = (text) => text.replace(/[()\\]/g, '\\$&');
const textOps = (lines, size = FONT_SIZE) => ['BT', `/F1 ${size} Tf`, ...lines.flatMap(({ x, baseline, text }) => [`1 0 0 1 ${x} ${baseline} Tm`, `(${escape(text)}) Tj`]), 'ET'].join('\n');
const fmt = (rect) => rect.map((v) => Math.round(v * 1000) / 1000).join(' ');

/** @param {{ salt?: string }} [options] `salt` goes into a header comment so re-imports are not deduplicated (pdf.js
 * fingerprints the first 1024 bytes when there is no /ID). */
export function buildPdfLinkFixture(options = {}) {
  const page1Lines = [WIDE_LINE, ...Object.values(LINKS)].map(({ x, baseline, text }) => ({ x, baseline, text }));
  for (let i = 0; i < 6; i++) page1Lines.push({ x: 54, baseline: 420 - i * 20, text: `Body line ${i + 1} of page one, filler text so the page scrolls like a paper.` });
  const page3Lines = [{ x: 54, baseline: 780, text: 'References' }];
  for (let i = 0; i < 18; i++) page3Lines.push({ x: 72, baseline: 760 - i * 20, text: `[${i + 1}] Filler reference ${i + 1}.` });
  page3Lines.push(REFERENCE);
  for (let i = 0; i < 8; i++) page3Lines.push({ x: 72, baseline: 380 - i * 20, text: `[${13 + i}] Filler reference ${13 + i}.` });

  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; }; // 1-based object number
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>');
  const pagesId = objects.length + 1; add('PAGES_PLACEHOLDER');
  const stream = (ops) => add(`<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`);
  const c1 = stream(textOps(page1Lines));
  const c2 = stream(textOps([{ x: ROTATED.x, baseline: ROTATED.baseline, text: ROTATED.text }, { x: 54, baseline: 740, text: 'Rotated page: /Rotate 90.' }]));
  const c3 = stream(textOps(page3Lines));
  const filler = (n) => stream(textOps(Array.from({ length: 12 }, (_, i) => ({ x: 54, baseline: 780 - i * 24, text: `Filler page ${n}, line ${i + 1}: nothing to link here.` }))));
  const c4 = filler(4);
  const c5 = filler(5);
  // Page objects are created before their annotations so /Dest arrays can reference them.
  const p1 = objects.length + 1; add('P1');
  const p2 = objects.length + 1; add('P2');
  const p3 = objects.length + 1; add('P3');
  const p4 = objects.length + 1; add('P4');
  const p5 = objects.length + 1; add('P5');
  const link = (rect, body) => add(`<< /Type /Annot /Subtype /Link /Border [0 0 0] /Rect [${fmt(rect)}] ${body} >>`);
  const L = LINKS;
  const annots1 = [
    link(glyphRect(L.citation.x, L.citation.baseline, L.citation.text), `/Dest [${p3} 0 R /XYZ ${XYZ_TARGET.left} ${XYZ_TARGET.top} 0]`),
    link(wideRect(L.section.baseline), '/Dest (sec2)'),
    link(wideRect(L.https.baseline), `/A << /S /URI /URI (${escape(L.https.url)}) >>`),
    link(wideRect(L.javascript.baseline), `/A << /S /URI /URI (${escape(L.javascript.url)}) >>`),
    link(wideRect(L.mailto.baseline), `/A << /S /URI /URI (${escape(L.mailto.url)}) >>`),
    link(wideRect(L.nextPage.baseline), '/A << /S /Named /N /NextPage >>'),
    link(wideRect(L.fit.baseline), `/Dest [${p2} 0 R /Fit]`),
    link(wideRect(L.broken.baseline), '/Dest (nowhere)'),
    link(wideRect(L.fitR.baseline), `/Dest [${p3} 0 R /FitR ${FITR_TARGET.left} ${FITR_TARGET.bottom} ${FITR_TARGET.right} ${FITR_TARGET.top}]`),
  ];
  const annots2 = [link(glyphRect(ROTATED.x, ROTATED.baseline, ROTATED.text), `/Dest [${p3} 0 R /XYZ ${XYZ_TARGET.left} ${XYZ_TARGET.top} 0]`)];
  const page = (contents, annots, extra = '') => `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R${annots.length ? ` /Annots [${annots.map((id) => `${id} 0 R`).join(' ')}]` : ''}${extra} >>`;
  objects[p1 - 1] = page(c1, annots1);
  objects[p2 - 1] = page(c2, annots2, ' /Rotate 90');
  objects[p3 - 1] = page(c3, []);
  objects[p4 - 1] = page(c4, []);
  objects[p5 - 1] = page(c5, []);
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${p1} 0 R ${p2} 0 R ${p3} 0 R ${p4} 0 R ${p5} 0 R] /Count 5 >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R /Dests << /sec2 [${p2} 0 R /FitH ${FITH_TOP}] >> >>`);

  let out = options.salt ? `%PDF-1.4\n%variant ${String(options.salt).replace(/[^\w.-]/g, '_')}\n` : '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

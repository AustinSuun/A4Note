import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const cases = [
  { path: new URL('../src-tauri/assets/aster-guide.pdf', import.meta.url), minPages: 1 },
];

for (const testCase of cases) {
  const data = await readFile(testCase.path);
  const pdf = await getDocument({ data: new Uint8Array(data) }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });

  if (pdf.numPages < testCase.minPages) {
    throw new Error(`Expected at least ${testCase.minPages} page, got ${pdf.numPages}: ${testCase.path.pathname}`);
  }

  if (!viewport.width || !viewport.height) {
    throw new Error(`PDF.js returned an invalid viewport: ${testCase.path.pathname}`);
  }

  console.log(`PDF.js parsed ${testCase.path.pathname}: ${pdf.numPages} page, ${viewport.width}x${viewport.height}`);
}

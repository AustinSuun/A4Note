// Generates the note-switch performance samples for scripts/perf-markdown-switch.mjs (test data only):
// 01 note with properties, 02 long note (>=100KB), 03 >=10 KaTeX formulas, 04 six local images, 05 mixed.
//   npm run perf:markdown-switch-notes -- <folder>/perf
if (!process.argv[2]) { console.error('usage: node scripts/perf-markdown-switch-notes.mjs <output folder>'); process.exit(2); }
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const dir = process.argv[2]; fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(w, h, seed) {
  const raw = Buffer.alloc((w * 3 + 1) * h); let s = seed;
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w * 3; x++) { s = (s * 1103515245 + 12345) >>> 0; const base = x % 3 === 0 ? (x / 3) * 255 / w : x % 3 === 1 ? y * 255 / h : 128; raw[y * (w * 3 + 1) + 1 + x] = (base + (s >>> 24) % 90) & 255; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}
const para = (i) => `第 ${i} 段：分治法把问题拆成规模更小的同类子问题，递归求解后再合并结果。This paragraph exists to give the editor realistic prose with **bold**, *italic*, \`inline code\` and a [link](https://example.com/${i}). 复杂度分析常用主定理 T(n)=aT(n/b)+f(n)。`;
fs.writeFileSync(path.join(dir, '01-分支法思想.md'), `---\ndate: 2025-07-04 00:00\nauthor: [Austin]\ntags: [递归, 分治]\n---\n# 分支法思想：分+治+合\n\n# 分支法思想：分+治+合\n\n上图以 $T(n) = 4T\\left(\\frac{2}{n}\\right)$ 为例\n\n分治（Divide and Conquer）三步：**分**、**治**、**合**。\n\n## 分\n\n${[1,2,3,4].map(para).join('\n\n')}\n\n## 治\n\n- 递归到基例\n- 子问题相互独立\n\n## 合\n\n${[5,6,7].map(para).join('\n\n')}\n`);
let long = '# 长文样例（≥100KB）\n\n';
for (let s = 1; long.length < 60000 || Buffer.byteLength(long) < 110 * 1024; s++) { long += `## 第 ${s} 节\n\n${[0,1,2,3].map((k) => para(s * 10 + k)).join('\n\n')}\n\n- 要点 ${s}.1\n- 要点 ${s}.2\n  - 子项\n\n> 引用 ${s}：保持简单。\n\n`; }
fs.writeFileSync(path.join(dir, '02-长文.md'), long);
const formulas = ['\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', 'T(n) = 2T\\left(\\frac{n}{2}\\right) + \\Theta(n)', '\\int_0^1 x^2\\,dx = \\frac{1}{3}', 'e^{i\\pi} + 1 = 0', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}^{-1} = \\frac{1}{ad-bc}\\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}', 'f(x) = \\begin{cases} x^2 & x \\ge 0 \\\\ -x & x < 0 \\end{cases}', '\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}', '\\lim_{n\\to\\infty} \\left(1+\\frac{1}{n}\\right)^n = e'];
let math = '# 公式样例（≥10 个 KaTeX）\n\n';
for (let i = 0; i < 24; i++) math += `### 公式 ${i + 1}\n\n行内 $${formulas[i % formulas.length]}$ 与块级：\n\n$$\n${formulas[(i + 3) % formulas.length]}\n$$\n\n`;
fs.writeFileSync(path.join(dir, '03-公式.md'), math);
let imgs = '# 图片样例（≥5 张本地图片）\n\n';
for (let i = 1; i <= 6; i++) { const f = `assets/sample-${i}.png`; fs.writeFileSync(path.join(dir, f), png(1100, 900, i * 7919)); imgs += `## 图 ${i}\n\n![样例图 ${i}](${f})\n\n${para(i)}\n\n`; }
fs.writeFileSync(path.join(dir, '04-图片.md'), imgs);
let mixed = '# 混合样例\n\n';
for (let i = 1; i <= 8; i++) mixed += `## 小节 ${i}\n\n${para(i)}\n\n| 列 A | 列 B | 列 C |\n| --- | --- | --- |\n| ${i} | ${i * 2} | ${i * 3} |\n| x | y | z |\n\n\`\`\`ts\nexport const value${i} = ${i} * 2;\n\`\`\`\n\n> [!note] 提示 ${i}\n> 带 callout 的段落。\n\n行内公式 $a_${i}^2 + b^2 = c^2$。\n\n`;
mixed += '![混合图](assets/sample-1.png)\n';
fs.writeFileSync(path.join(dir, '05-混合.md'), mixed);
for (const f of fs.readdirSync(dir)) { const st = fs.statSync(path.join(dir, f)); if (st.isFile()) console.log(f, st.size); }
for (const f of fs.readdirSync(path.join(dir, 'assets'))) console.log('assets/' + f, fs.statSync(path.join(dir, 'assets', f)).size);

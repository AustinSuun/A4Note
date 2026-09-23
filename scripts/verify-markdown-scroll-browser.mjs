import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

// Isolated browser run against real resource/editor modules; never open user notes.
const dir = path.resolve('.tmp/markdown-scroll-browser');
fs.mkdirSync(dir, { recursive: true });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="96"><rect width="240" height="96" fill="tomato"/></svg>';
fs.writeFileSync(path.join(dir, 'area.svg'), svg);
const image = 'http://127.0.0.1:@@PORT@@/.tmp/markdown-scroll-browser/area.svg';
const note = [
  '# 布局回归专用标题', '', '## 布局段落一',
  '这是一行普通 **加粗文本** 和 [长链接](https://example.invalid/really/long/destination/here) 及 `inline code`，用于检查混合源码与渲染后的高度。',
  '这是一行普通 **加粗文本** 和 [长链接](https://example.invalid/really/long/destination/here) 及 `inline code`，用于检查混合源码与渲染后的高度。',
  `图片预览前缀 ![布局预览图](${image}) 图片后的 **标记文本**。`,
  '混合行公式 $\\frac{1}{x+y}$ 和 **粗体文本** 及 `行内代码`。',
  '> [!NOTE] 标注块前缀 **粗体文字** 和 [链接](https://example.invalid/long-url/path)',
  '> 标注块内容，依然保持光标进入后的完整编辑能力。',
  '', '| 甲 | 乙 |', '| --- | --- |', '| A long cell value | $x^2 + y^2$ |',
  '', '$$', '\\frac{a}{b}+\\sum_{k=0}^{10} k', '$$', '',
  '双链 [[目标笔记]] 测试。',
  ...Array.from({ length: 14 }, (_, i) => `\n## 后续段落 ${i+1}\n\n正文 ${i+1} ${'填充段落 **加粗** 及 `代码` 供滚动。'.repeat(5)}\n\n普通段落 ${i+1} ${'纯文本填充。'.repeat(15)}`),
].join('\n');
fs.writeFileSync(path.join(dir, 'regression-note.md'), note);
fs.writeFileSync(path.join(dir, 'regression-mock.ts'), `import { useState } from 'react';\nimport fixture from './regression-note.md?raw';\nexport function useTextDocument(path: string) { const [content, setContent] = useState(fixture); (window as any).__replaceNote = setContent; return {documentId:path,content,setContent,loading:false,error:'',saveState:'saved',saveError:'',save:()=>{},reload:async()=>{}}; }`);
fs.writeFileSync(path.join(dir, 'regression-host.tsx'), `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { EditorView } from '@codemirror/view';\nimport { MarkdownResourceTab } from '/src/features/explorer/MarkdownResourceTab';\nimport '/src/ui/styles/tokens.css'; import '/src/ui/styles/base.css'; import '/src/ui/styles/workbench.css'; import '/src/ui/styles/markdown.css';\n(window as any).__view=()=>EditorView.findFromDOM(document.querySelector('.markdown-live-codemirror .cm-editor'));\nconst shell=document.getElementById('root')!;shell.style.cssText='height:720px;width:min(1200px,100vw);display:flex;position:relative;';\ncreateRoot(shell).render(<MarkdownResourceTab path="C:\\\\synthetic\\\\scroll-regression.md" name="scroll-regression.md" onOpenWikiLink={(target)=>{(window as any).__lastWiki=target;}} />);`);
fs.writeFileSync(path.join(dir, 'regression.html'), '<!doctype html><html><head><meta charset="utf-8"/><link rel="icon" href="data:,"/></head><body><div id="root"></div><script type="module" src="./regression-host.tsx"></script></body></html>');
const errors=[];let server,browser;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
  server=await createServer({ configFile:false, root:process.cwd(), cacheDir:path.join(dir,'vite-cache'), plugins:[react()], resolve:{alias:[{find:'./useTextDocument',replacement:path.join(dir,'regression-mock.ts')}]}, server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.tmp/**','**/.build/**','**/.worktrees/**','**/node_modules/**','**/src-tauri/target/**']}}, logLevel:'error' });
  await server.listen();
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1200,height:800}});
  page.on('pageerror', e=>errors.push('pageerror '+e.message));
  page.on('console', msg=>{ if(msg.type()==='error')errors.push('console '+msg.text()); });
  page.on('response', r=>{if(r.status()>=400)errors.push('http '+r.status()+' '+r.url());});
  const port=server.httpServer.address().port;
  fs.writeFileSync(path.join(dir,'regression-note.md'),note.replace('@@PORT@@',String(port)));
  await page.goto(`http://127.0.0.1:${port}/.tmp/markdown-scroll-browser/regression.html`,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.markdown-live-codemirror .cm-editor .cm-line',{timeout:30000});
  await page.waitForFunction(()=>!!window.__view?.(),null,{timeout:30000});
  await sleep(700);
  const labels=[['ordinary','普通 **加粗文本**',10],['image','![布局预览图]',8],['math','$\\frac{1}{x+y}$',4],['callout','> [!NOTE]',4]];
  const results=[];
  for(const [name, needle, offset] of labels) {
    const sample = async(search)=>page.evaluate(({needle,offset,search})=>{
      const view=window.__view(); const found=view.state.doc.toString().indexOf(needle); if(found<0)throw Error('missing marker '+needle);
      const line=view.state.doc.lineAt(found); const target=search ? found+offset : Math.max(0, line.from-1);
      view.dispatch({selection:{anchor:target},scrollIntoView:true});
      return line.from;
    },{needle,offset,search});
    const from=await sample(false);await sleep(280);
    const read=()=>page.evaluate(from=>{const row=document.querySelector(`.cm-content > .cm-line[data-preview-line="${from}"]`);return row&&{height:row.getBoundingClientRect().height,reserved:getComputedStyle(row).minHeight,scrollHeight:document.querySelector('.markdown-resource-content').scrollHeight,text:row.textContent?.slice(0,120)};},from);
    const rendered=await read();assert.ok(rendered,`${name}: rendered line present`);
    await sample(true);await sleep(280);const source=await read();assert.ok(source,`${name}: source line present`);
    results.push({name,renderedHeight:rendered.height,sourceHeight:source.height});
    if(name==='image') assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.cm-content img.cm-md-image')].some(img=>img.complete&&img.naturalWidth===240)), 'decoded image keeps its dimensions');
    assert.ok(Math.abs(source.height-rendered.height)<3,`${name} line height jumps ${JSON.stringify({rendered,source})}`);
    if(name==='image') assert.ok(await page.locator('.cm-md-image-source').count()>0,'image source remains editable');
    if(name==='math') assert.ok(await page.locator('.cm-md-math-source').count()>0,'math source remains editable');
    if(name==='callout') assert.ok(source.text.includes('[!NOTE]'),'callout marker source remains visible');
  }
  // Reaching a table row must not shrink the authored block below its pre-measured reservation.
  const table = async(onTable)=>page.evaluate(onTable=>{
    const view=window.__view();const found=view.state.doc.toString().indexOf('| 甲 |');
    view.dispatch({selection:{anchor:onTable?found+2:Math.max(0,found-2)},scrollIntoView:true});
    const sc=document.querySelector('.markdown-resource-content');
    return {from:view.state.doc.lineAt(found).from,scrollHeight:sc.scrollHeight};
  },onTable);
  const initial=await table(false);await sleep(350);
  const tableRendered=await page.evaluate(()=>({height:document.querySelector('.markdown-resource-content').scrollHeight,widget:!!document.querySelector('.cm-md-table-reservation')}));
  await table(true);await sleep(350);
  const tableSource=await page.evaluate(()=>({height:document.querySelector('.markdown-resource-content').scrollHeight,source:!!document.querySelector('[data-preview-table-source]')}));
  assert.ok(tableRendered.widget&&tableSource.source,'table switches between widget and editable source');
  assert.ok(Math.abs(tableSource.height-tableRendered.height)<6,`table scroll height jumps ${JSON.stringify({tableRendered,tableSource})}`);
  results.push({name:'table',initial,tableRendered,tableSource});
  const display = async(source)=>page.evaluate(source=>{
    const view=window.__view(), found=view.state.doc.toString().indexOf('$$\n');
    view.dispatch({selection:{anchor:source?found+4:0},scrollIntoView:true});
  },source);
  await display(false);await sleep(350);
  const mathRendered=await page.evaluate(()=>({height:document.querySelector('.markdown-resource-content').scrollHeight,rendered:!!document.querySelector('[data-math-display="true"]')}));
  await display(true);await sleep(350);
  const mathSource=await page.evaluate(()=>({height:document.querySelector('.markdown-resource-content').scrollHeight,source:!!document.querySelector('.cm-md-math-display-source')}));
  assert.ok(mathRendered.rendered&&mathSource.source,'display formula switches to editable source');
  assert.ok(Math.abs(mathRendered.height-mathSource.height)<6,`display math scroll height jumps ${JSON.stringify({mathRendered,mathSource})}`);
  results.push({name:'display-math',mathRendered,mathSource});
  // Folding changes the decoration model without editing text; its measured
  // reservations must follow the fold and restore after expanding.
  await page.evaluate(()=>{const view=window.__view();view.dispatch({selection:{anchor:view.state.doc.toString().indexOf('## 布局段落一')},scrollIntoView:true});});
  await page.waitForSelector('.cm-md-heading-fold-toggle[aria-expanded="true"]');
  await sleep(400);
  const foldBefore=await page.evaluate(()=>document.querySelector('.markdown-resource-content').scrollHeight);
  await page.locator('.cm-md-heading-fold-toggle[aria-expanded="true"]').first().click();
  await page.waitForSelector('.cm-md-heading-fold-toggle[aria-expanded="false"]');
  await sleep(400);
  const foldDuring=await page.evaluate(()=>document.querySelector('.markdown-resource-content').scrollHeight);
  assert.ok(foldDuring<foldBefore-100,'fold removes its content and measurements');
  await page.locator('.cm-md-heading-fold-toggle[aria-expanded="false"]').first().click();
  await page.waitForSelector('.cm-md-heading-fold-toggle[aria-expanded="true"]');
  await sleep(1000);
  const foldAfter=await page.evaluate(()=>({height:document.querySelector('.markdown-resource-content').scrollHeight,placeholders:document.querySelectorAll('.cm-md-heading-fold-placeholder').length}));
  assert.ok(foldAfter.placeholders===0,'unfold removes fold placeholder');
  assert.ok(foldAfter.height>foldDuring+100,`unfold restores content ${JSON.stringify({foldBefore,foldDuring,foldAfter})}`);
  results.push({name:'fold',foldBefore,foldDuring,foldAfter:foldAfter.height});
  // Editing after viewport measurement must invalidate the cached decoration model.
  await page.evaluate(()=>{const view=window.__view(); const at=view.state.doc.toString().indexOf('## 后续段落 14'); view.dispatch({changes:{from:at,insert:'## 新增缓存失效检查\n\n新增正文\n\n'},selection:{anchor:at+14}})});
  await page.waitForFunction(()=>window.__view().state.doc.toString().includes('新增缓存失效检查'),null,{timeout:12000});
  await page.locator('.markdown-resource-mode-switch button:nth-child(2)').click();
  await page.waitForSelector('article.markdown-resource-preview');
  await page.locator('.markdown-toc-toggle').click();
  assert.ok(await page.locator('article.markdown-resource-preview h2:has-text("新增缓存失效检查")').count(),'document edit updates read cache');
  assert.ok(await page.locator('.markdown-toc-item:has-text("新增缓存失效检查")').count(),'document edit updates TOC');
  await page.locator('.markdown-wiki-link').first().click();
  await page.waitForFunction(()=>window.__lastWiki==='目标笔记',null,{timeout:10000});
  // Outline following changes its active row but must not replace/reconcile the full article.
  await page.evaluate(()=>{window.__article=document.querySelector('article.markdown-resource-preview');window.__firstActive=document.querySelector('.markdown-toc-item.active')?.textContent;const s=document.querySelector('.markdown-resource-content');s.scrollTop=s.scrollHeight;});
  await sleep(700);
  const toc=await page.evaluate(()=>({sameArticle:document.querySelector('article.markdown-resource-preview')===window.__article,active:document.querySelector('.markdown-toc-item.active')?.textContent,was:window.__firstActive}));
  assert.ok(toc.sameArticle&&toc.active&&toc.active!==toc.was,`outline follow failed ${JSON.stringify(toc)}`);
  await page.locator('.markdown-toc-item:has-text("布局段落一")').click();
  await page.waitForFunction(()=>document.querySelector('.markdown-resource-content').scrollTop<1000,null,{timeout:5000});
  // External document updates in reading mode must invalidate memoized Markdown and TOC.
  await page.evaluate(()=>window.__replaceNote('# 替换文档标题\n\n## 替换后的标题\n\n来自外部更新的正文 [[新目标]]。'));
  await page.waitForSelector('article.markdown-resource-preview h2:has-text("替换后的标题")');
  assert.ok(await page.locator('.markdown-toc-item:has-text("替换后的标题")').count(),'outline updates with external note change');
  await page.locator('.markdown-wiki-link').first().click();await page.waitForFunction(()=>window.__lastWiki==='新目标',null,{timeout:10000});
  await page.locator('.markdown-resource-mode-switch button:nth-child(1)').click();
  await page.waitForSelector('.markdown-live-codemirror .cm-editor');
  assert.ok(await page.evaluate(()=>window.__view().state.doc.toString().includes('替换后的标题')),'edited document matches reading mode after switch');
  await page.locator('[aria-label="实时，切换到源码编辑"]').click();
  await page.waitForSelector('.markdown-live-codemirror.source-mode .cm-editor');
  assert.ok(await page.evaluate(()=>window.__view().state.doc.toString().includes('[[新目标]]')),'raw Markdown stays editable in source mode');
  await page.locator('[aria-label="源码，切换到实时预览"]').click();
  await page.waitForSelector('.markdown-live-codemirror:not(.source-mode) .cm-editor');
  assert.deepEqual(errors,[]);
  console.log('PASS Markdown scroll/browser regressions: reserved layout, edit/source, folding, TOC follow, read cache invalidation and links', JSON.stringify({ results, toc }));
} catch(e) {console.error('FAILED browser scroll regressions:',e,JSON.stringify(errors));process.exitCode=1;}
finally {await browser?.close();await server?.close();}

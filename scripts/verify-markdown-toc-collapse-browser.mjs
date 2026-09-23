import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';
const root = process.cwd();
const host = path.join(root, '.tmp/toc-collapse-browser');
const evidence = path.join(root, '.tmp/shots/toc-collapse-browser');
fs.mkdirSync(host, { recursive: true }); fs.mkdirSync(evidence, { recursive: true });
const sample = '# 文档\n\n## 第一章\n\n正文\n\n### 子标题\n\n#### 四级\n\n##### 五级\n\n###### 六级\n\n## 第二章\n\n#### 跳级标题\n\n## '+ '很长的标题'.repeat(30)+'\n\n## 重复\n\n### 子项\n\n## 重复\n\n### 子项\n';
fs.writeFileSync(path.join(host, 'index.html'), '<html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>');
fs.writeFileSync(path.join(host, 'mock.ts'), `import { useState } from 'react';
export function useTextDocument(path){ const [content,setContent]=useState(${JSON.stringify(sample)});const [documentId,setDocument]=useState(1);Object.assign(window,{tocContent:content,tocSetContent:setContent,tocSetDocument:setDocument});return {documentId,content,setContent,loading:false,error:'',saveState:'saved',saveError:'',save(){},reload(){}};}`);
fs.writeFileSync(path.join(host, 'host.tsx'), `import React from 'react';import{createRoot}from'react-dom/client';import{MarkdownResourceTab}from'/src/features/explorer/MarkdownResourceTab';import'/src/ui/styles.css';createRoot(document.getElementById('root')).render(<MarkdownResourceTab path="D:/isolated/toc.md" name="toc.md"/>);`);
let server, browser;
const errors = [], records = [];
function check(ok, name, detail) { records.push({ name, ok: !!ok, detail }); assert.ok(ok, name+' '+JSON.stringify(detail ?? '')); }
try {
 server = await createServer({ root, configFile: false, cacheDir: path.join(host, 'cache'), optimizeDeps: { entries: ['.tmp/toc-collapse-browser/index.html'] }, plugins: [{ name:'mock-document', enforce:'pre', resolveId(id, importer){ if(id==='./useTextDocument' && importer?.includes('MarkdownResourceTab'))return path.join(host,'mock.ts'); } }, react()],server:{ host:'127.0.0.1',port:0,watch:null }, logLevel:'error' });
 await server.listen();
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e))); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.config.server.port}/.tmp/toc-collapse-browser/index.html`);
 await page.addStyleTag({content:'html,body,#root{height:100%;margin:0}.markdown-resource-tab{height:100%}'});
 await page.locator('.markdown-resource-mode-switch button').nth(1).click();
 await page.getByRole('button',{name:'打开目录',exact:true}).click();
 const rows=page.locator('[data-toc-heading-id]');
 await rows.first().waitFor();
 const count=await rows.count();check(count===13,'all headings including H1-H6 and skipped level',count);
 const before=await page.evaluate(()=>({content:window.tocContent,html:document.querySelector('.markdown-resource-preview').innerHTML,scroll:document.querySelector('.markdown-resource-content').scrollTop}));
 const first=page.getByRole('button',{name:'收起 第一章',exact:true});
 check(await first.count()===1,'real disclosure button exists');
 await first.click();check(await rows.count()===9,'collapse hides complete descendants');
 check(await page.evaluate(()=>window.tocContent)===before.content,'collapse does not edit text');
 check(await page.locator('.markdown-resource-preview').innerHTML()===before.html,'collapse does not hide body');
 check(await page.getByRole('button',{name:'展开 第一章',exact:true}).getAttribute('aria-expanded')==='false','aria-expanded false');
 check(await page.evaluate(()=>document.querySelector('.markdown-resource-content').scrollTop)===before.scroll,'disclosure does not navigate');
 await page.getByRole('button',{name:'展开 第一章',exact:true}).focus();await page.keyboard.press('Enter');check(await rows.count()===13,'keyboard Enter expands');
 await page.getByRole('button',{name:'收起 子标题',exact:true}).focus();await page.keyboard.press('Space');check(await rows.count()===10,'keyboard Space collapses child');
 await page.getByRole('button',{name:'收起 第一章',exact:true}).click();await page.getByRole('button',{name:'展开 第一章',exact:true}).click();
 check(await page.getByRole('button',{name:'展开 子标题',exact:true}).count()===1 && await rows.count()===10,'parent round trip retains nested collapse');
 await page.evaluate(()=>window.tocSetContent(window.tocContent.replace('## 第一章','## 新插入\n\n## 第一章')));
 await page.waitForTimeout(100);check(await page.getByRole('button',{name:'展开 子标题',exact:true}).count()===1,'unrelated heading insertion retains semantic collapse');
 await page.getByRole('button',{name:'展开 子标题',exact:true}).click();
 const leaf=page.locator('[data-toc-heading-id]').filter({has:page.locator('button.markdown-toc-label',{hasText:'六级'})});
 check(await leaf.locator('button.markdown-toc-caret').count()===0,'leaf has no disclosure');
 const duplicate=page.getByRole('button',{name:'收起 重复',exact:true});await duplicate.first().click();check(await page.getByRole('button',{name:'收起 重复',exact:true}).count()===1,'duplicate headings have independent keys');
 await page.evaluate(()=>window.tocSetDocument(2));await page.waitForTimeout(80);check(await page.getByRole('button',{name:'收起 重复',exact:true}).count()===2,'different document does not inherit folds');
 await page.locator('.markdown-toc-label').filter({hasText:'第二章'}).click();check(await page.locator('.markdown-toc-label[aria-current="location"]').textContent()==='第二章','title navigation and current marker');
 for(const theme of ['light','midnight']) for(const zoom of [1,1.25,1.5]){
  await page.evaluate(({theme,zoom})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.zoom=String(zoom)}, {theme,zoom});await page.waitForTimeout(150);
  for(const width of [280,220]){
   await page.locator('.markdown-toc-panel').evaluate((el,width)=>{el.style.width=width+'px';el.style.minWidth='0'},width);await page.waitForTimeout(80);
   const m=await page.evaluate(()=>{
    const list=document.querySelector('.markdown-toc-list');const rows=[...list.querySelectorAll('[data-toc-heading-id]')];const rails=[...list.querySelectorAll('.markdown-toc-guide-rail')];const scale=list.getBoundingClientRect().width/list.offsetWidth;
    const expectedParents=rows.filter(r=>r.querySelector('[aria-expanded="true"]'));
    return {overflow:list.scrollWidth-list.clientWidth,axisErrors:rails.map((rail,i)=>{const r=rail.getBoundingClientRect(),c=expectedParents[i].querySelector('.markdown-toc-caret').getBoundingClientRect();return Math.abs(r.left+r.width/2-c.left-c.width/2)}),widths:rails.map(r=>getComputedStyle(r).width),rowHeights:rows.map(r=>r.getBoundingClientRect().height/scale),ellipsis:[...list.querySelectorAll('.markdown-toc-label')].every(r=>getComputedStyle(r).textOverflow==='ellipsis')};
   });
   check(m.overflow<=1,`no horizontal overflow ${theme}/${zoom}/${width}`,m.overflow);check(m.axisErrors.every(e=>e<1.3),`rails aligned in layout pixels ${theme}/${zoom}/${width}`,m.axisErrors);check(m.widths.every(w=>w==='1px'),`neutral fine rails ${theme}/${zoom}/${width}`,m.widths);check(m.ellipsis,`long titles ellipsized ${theme}/${zoom}/${width}`);
  }
  await page.screenshot({path:path.join(evidence,`${theme}-${zoom}.png`)});
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'收起 文档',exact:true}).click();check(await rows.count()===1,'root collapse in reduced motion');
 await page.waitForTimeout(100);check(await page.locator('.markdown-toc-guide-rail').count()===0,'collapsed root removes all rails');
 await page.getByRole('button',{name:'展开 文档',exact:true}).click();check(await rows.count()===14,'root reopens');
 check(errors.length===0,'no page/console errors',errors);
 console.log(JSON.stringify({passed:true,checks:records.length,evidence}));
} catch(error) { records.push({ok:false,name:'execution',error:String(error)});process.exitCode=1;console.error(error); }
finally {fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({records,errors},null,2));await browser?.close();await server?.close();}

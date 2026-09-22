import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

const root = process.cwd();
const hostDir = path.join(root, '.tmp', 'tree-guides-browser');
const evidence = path.join(root, '.tmp', 'shots', 'tree-guides', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(hostDir, { recursive: true });
fs.mkdirSync(evidence, { recursive: true });
fs.writeFileSync(path.join(hostDir, 'index.html'), '<div id="root"></div><script type="module" src="./host.tsx"></script>');
fs.writeFileSync(path.join(hostDir, 'host.tsx'), `
import React,{useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {TreeGuides} from '/src/shared/tree/TreeGuides';
import '/src/ui/styles/tokens.css';
import '/src/ui/styles/workbench.css';
const rows=[
 ['论文',0,true,'folder'],['00_Workstation',1,false,'folder'],['01_Library',1,false,'folder'],
 ['02_Notes',1,true,'folder'],['实验',2,true,'folder'],['阶段',3,true,'folder'],['样本',4,true,'folder'],
 ['LNN点云识别设计-这是一个非常长的中英文混合名称',5,false,'html'],['末项',4,false,'file'],['同级末项',1,false,'file']
];
function Tree({kind}){const box=useRef(null),content=useRef(null);return <div className={'harness '+kind} data-kind={kind}>
 <div ref={box} className="file-tree-tree"><TreeGuides containerRef={box} contentRef={content}/><div ref={content} className="file-tree-tree-content">
 {rows.map(([id,depth,expanded,type],i)=>kind==='explorer'?<button key={id} className={'file-tree-row '+(type==='folder'?'directory':'file')+(i===1?' active':'')} data-tree-row={id} data-tree-depth={depth} data-tree-expanded={expanded?'true':undefined} style={{paddingLeft:'calc(8px + '+depth+' * var(--file-tree-depth-step))'}}><span className={type==='folder'?'file-tree-caret':'file-tree-caret-spacer'} data-tree-caret></span><span className="file-tree-name">{id}</span>{type==='html'&&<span className="file-tree-type">HTML</span>}</button>:
 <div key={id} className="file-tree-row-wrap" data-tree-row={id} data-tree-depth={depth} data-tree-expanded={expanded?'true':undefined}><button className={'file-tree-row '+(type==='folder'?'directory':'file')+(i===1?' active':'')} style={{paddingLeft:'calc(8px + '+depth+' * var(--file-tree-depth-step))'}}><span className={type==='folder'?'file-tree-caret':'file-tree-caret-spacer'} data-tree-caret></span><span className="file-tree-name">{id}</span>{type==='html'&&<span className="file-tree-type">HTML</span>}</button></div>)}</div></div></div>}
function App(){return <main><Tree kind="explorer"/><Tree kind="library"/></main>};createRoot(document.getElementById('root')).render(<App/>);
`);
fs.writeFileSync(path.join(hostDir, 'harness.css'), '');
let server;
const results=[];
try {
 server=await createServer({configFile:false,root,cacheDir:path.join(hostDir,'cache'),plugins:[react()],server:{host:'127.0.0.1',port:0},logLevel:'error'}); await server.listen();
 const url=`http://127.0.0.1:${server.config.server.port}/.tmp/tree-guides-browser/index.html`;
 for(const dpr of [1,1.25,1.5]){
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context=await browser.newContext({viewport:{width:1000,height:900},deviceScaleFactor:dpr}); const page=await context.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(String(e))); page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text())}); await page.goto(url);
  await page.addStyleTag({content:'body{margin:0}main{display:flex;gap:20px;padding:16px}.harness{width:300px;height:500px;overflow:auto;border:1px solid #ccc}.file-tree-tree{min-height:100%}.file-tree-row{display:flex}.file-tree-type{flex:none}.file-tree-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'});
  for(const zoom of [.8,1,1.25,1.5]){
   await page.evaluate(z=>{document.documentElement.style.zoom=String(z)},zoom); await page.waitForTimeout(100);
   for(const kind of ['explorer','library']){
    const metric=await page.evaluate(kind=>{const host=document.querySelector('[data-kind="'+kind+'"]');const rows=[...host.querySelectorAll('[data-tree-row]')];const rails=[...host.querySelectorAll('.file-tree-guide-rail')];const branches=[...host.querySelectorAll('.file-tree-guide-branch')];const center=e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,right:r.right,top:r.top,bottom:r.bottom}};return {rowAxes:rows.map(r=>center(r.querySelector('[data-tree-caret]')).x),rowIds:rows.map(r=>r.dataset.treeRow),rowDepths:rows.map(r=>Number(r.dataset.treeDepth)),railAxes:rails.map(center).map(x=>x.x),railIds:rails.map(r=>r.dataset.guideId),railBottoms:rails.map(center).map(x=>x.bottom),branchCount:branches.length,rowBottoms:rows.map(center).map(x=>x.bottom),errors:[]}},kind);
    const axisError=Math.max(...metric.railAxes.map((x,i)=>Math.abs(x-metric.rowAxes[metric.rowIds.indexOf(metric.railIds[i])])));
    const depthAxis=new Map();metric.rowDepths.forEach((depth,i)=>{if(!depthAxis.has(depth))depthAxis.set(depth,metric.rowAxes[i])});
    const stepErrors=[1,2,3,4,5].map(depth=>Math.abs((depthAxis.get(depth)-depthAxis.get(depth-1))-20*zoom));
    const maxStepError=Math.max(...stepErrors);
    // Preserve the original vertical-only visual language: no connector arms.
    const rootIndex=metric.railIds.indexOf('论文');
    const rootEndError=Math.abs(metric.railBottoms[rootIndex]-(metric.rowBottoms[9]-3*zoom));
    const record={dpr,zoom,kind,axisError,maxStepError,rootEndError,branchCount:metric.branchCount,rails:metric.railAxes.length,errors};results.push(record);
    if(axisError>.55||maxStepError>.55||rootEndError>.75||metric.branchCount!==0||errors.length) throw Error('tree geometry regression '+JSON.stringify(record));
   }
  }
  if(dpr===1.25) await page.screenshot({path:path.join(evidence,'tree-guides-125pct-dpr125.png'),fullPage:true});
  await browser.close();
 }
 fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({passed:true,results},null,2));
 console.log(JSON.stringify({passed:true,evidence,cases:results.length,maxAxisError:Math.max(...results.map(x=>x.axisError)),maxStepError:Math.max(...results.map(x=>x.maxStepError)),maxRootEndError:Math.max(...results.map(x=>x.rootEndError))},null,2));
} finally {await server?.close();}

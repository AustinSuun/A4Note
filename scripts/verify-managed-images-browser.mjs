import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';
const require = createRequire(import.meta.url);
const dir = path.resolve('.tmp/managed-images-browser'); fs.mkdirSync(dir, {recursive:true});
const host = `import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client'; import {EditorView} from '@codemirror/view';
import {undo} from '@codemirror/commands';
import {MarkdownLivePreviewEditor} from '/src/features/explorer/MarkdownLivePreviewEditor';
import {PaperNoteImage} from '/src/features/reader/PaperNoteImage';
import {uploadSummaryImage} from '/src/platform/library/summaries';
import {uploadMarkdownImage} from '/src/platform/projects';
import {paperNoteImageDocument} from '/src/core/paperImageReference';
import '/src/ui/styles/tokens.css'; import '/src/ui/styles/markdown.css';
const w=window as any; const assets=new Map(); w.calls=[];w.delay=false;w.fail=false;w.pending=[];
w.__TAURI_INTERNALS__={invoke:async(command,args)=>{
 w.calls.push({command,args});
 if(command==='import_summary_image'||command==='import_markdown_image') {
  const execute=()=>{if(w.fail)throw Error('mock disk full');const name='asset-'+w.calls.length+'.png';const ref=(command==='import_summary_image'?'summary-assets':'test.assets')+'/'+name;assets.set((args.paperId||args.documentPath)+':'+ref,args.bytes);return ref;};
  if(w.delay)return new Promise((resolve,reject)=>w.pending.push(()=>{try{resolve(execute());}catch(e){reject(e);}}));return execute();
 }
 if(command==='read_summary_image'){const data=assets.get(args.paperId+':summary-assets/'+args.name);if(!data)throw Error('missing managed image');return data;}
 if(command==='read_file_bytes'){const suffix=args.request.path.split('/').slice(-2).join('/');for(const [key,value]of assets)if(key.endsWith(':'+suffix))return value;throw Error('missing local image');}
 throw Error('unexpected IPC '+command);
}};
w.settle=()=>{w.delay=false;const p=w.pending.splice(0);p.forEach(fn=>fn());};
function Host(){const [kind,setKind]=useState('ordinary'),[doc,setDoc]=useState('one'),[source,setSource]=useState(false),[text,setText]=useState('start\\n'),[visible,setVisible]=useState(true);const ref=useRef<any>(null);
 const documentPath=kind==='standalone'?'C:/synthetic/test.md':paperNoteImageDocument('p1',doc);
 w.text=text;w.change=(next)=>{setKind(next);setDoc(next);setText('start\\n');};w.replace=setText;w.source=setSource;w.visible=setVisible;w.ref=ref;
 w.view=()=>EditorView.findFromDOM(document.querySelector('.cm-editor'));
 w.undo=()=>undo(w.view());
 return <><button id="pick" onClick={()=>ref.current?.pickImages()}>选图</button><div style={{height:450,width:750,display:'flex',flexDirection:'column'}}>{visible&&<MarkdownLivePreviewEditor ref={ref} markdown={text} documentPath={documentPath} sourceMode={source} sessionId={kind==='standalone'?2:1} onChange={setText} onBlur={()=>{}} placeholder="测试" imageUpload={file=>kind==='standalone'?uploadMarkdownImage(documentPath,file):uploadSummaryImage('p1',file)}/>}</div></>;
}createRoot(document.getElementById('root')!).render(<Host/>);`;
fs.writeFileSync(path.join(dir,'host.tsx'),host);
fs.writeFileSync(path.join(dir,'index.html'),'<html><head><link rel="icon" href="data:,"/></head><body><div id="root"></div><script type="module" src="./host.tsx"></script></body></html>');
let server,browser,page; const errors=[],checks=[];
const check=(label,value)=>{assert.ok(value,label);checks.push(label);};
try {
 server=await createServer({configFile:false,root:process.cwd(),cacheDir:path.join(dir,'vite-cache'),plugins:[react()],server:{host:'127.0.0.1',port:0,fs:{allow:[process.cwd(),path.dirname(path.dirname(require.resolve('react/package.json')))]},watch:{ignored:['**/.build/**','**/src-tauri/**','**/node_modules/**']}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});page=await browser.newPage({viewport:{width:1000,height:700}});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/.tmp/managed-images-browser/index.html');await page.waitForSelector('.cm-editor');
 const paste=async({type='image/png',text='',image=true}={})=>page.evaluate(async({type,text,image})=>{
  const canvas=document.createElement('canvas');canvas.width=20;canvas.height=12;const context=canvas.getContext('2d');context.fillStyle='red';context.fillRect(0,0,20,12);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const file=new File([blob],'screenshot.png',{type});
  const data=new DataTransfer();if(image)data.items.add(file);if(text)data.setData('text/plain',text);
  const view=window.view();view.focus();const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});view.contentDOM.dispatchEvent(event);return event.defaultPrevented;
 },{type,text,image});
 for(const kind of ['ordinary','summary','standalone']) {
  await page.evaluate(kind=>window.change(kind),kind);await page.waitForFunction(()=>window.text==='start\n');
  await paste();await page.waitForFunction(()=>window.text.includes('asset-'));
  check(kind+' inserts relative reference, not base64',await page.evaluate(()=>!window.text.includes('data:image')&&/!\[screenshot\]\(<(?:summary-assets|test.assets)\/asset-\d+\.png>\)/.test(window.text)));
  await page.waitForFunction(()=>[...document.querySelectorAll('img.cm-md-image')].some(img=>img.naturalWidth===20));checks.push(kind+' real editor decodes stored image via mocked IPC');
  await page.evaluate(()=>window.source(true));await page.waitForTimeout(100);const before=await page.evaluate(()=>window.text);await paste({text:'混合文本'});await page.waitForFunction(before=>window.text!==before,before);check(kind+' source mode retains mixed plain text',await page.evaluate(()=>window.text.includes('混合文本')));
  await page.evaluate(()=>window.source(false));
 }
 await page.evaluate(()=>window.change('ordinary'));await page.waitForFunction(()=>window.text==='start\n');
 const calls=await page.evaluate(()=>window.calls.length);await paste({image:false,text:'纯文本'});await page.waitForFunction(()=>window.text.includes('纯文本'));check('plain text does not import an asset',await page.evaluate(()=>window.calls.length)===calls);
 await page.evaluate(()=>window.replace('unchanged'));await page.waitForFunction(()=>window.view().state.doc.toString()==='unchanged');await paste({type:'image/svg+xml'});await page.waitForSelector('[role="alert"]');check('unsupported MIME preserves draft',await page.evaluate(()=>window.text==='unchanged'));
 await page.evaluate(()=>{window.fail=true;});await paste();await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent?.includes('disk full'));check('write failure inserts nothing',await page.evaluate(()=>window.text==='unchanged'));await page.evaluate(()=>window.fail=false);
 for(const race of ['selection','document','undo','unmount']) {
  await page.evaluate(()=>{window.replace('race draft');window.delay=true;});await page.waitForFunction(()=>window.view().state.doc.toString()==='race draft');await paste();await page.waitForFunction(()=>window.pending.length===1);
  if(race==='selection')await page.evaluate(()=>window.view().dispatch({selection:{anchor:5}}));
  if(race==='document')await page.evaluate(()=>window.change('summary'));
  if(race==='undo')await page.evaluate(()=>{window.view().dispatch({changes:{from:0,insert:'x'}});window.undo();});
  if(race==='unmount')await page.evaluate(()=>window.visible(false));
  await page.evaluate(()=>window.settle());await page.waitForTimeout(150);
  check(race+' race never inserts a stale link',await page.evaluate(()=>!window.text.includes('asset-')));
  if(race==='unmount'){await page.evaluate(()=>window.visible(true));await page.waitForSelector('.cm-editor');}
 }
 // Native file picker callback uses the same transactional path.
 await page.evaluate(()=>window.change('ordinary'));await page.waitForFunction(()=>window.text==='start\n');
 const chooserPromise=page.waitForEvent('filechooser');await page.locator('#pick').click();const chooser=await chooserPromise;
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=20;c.height=12;return c.toDataURL('image/png').split(',')[1];});
 await chooser.setFiles({name:'selected.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.waitForFunction(()=>window.text.includes('selected'));
 check('file selection uses managed references',await page.evaluate(()=>window.text.includes('summary-assets/')&&!window.text.includes('data:image')));
 check('no pageerror or console errors',errors.length===0);
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({checks,errors,scope:'Real CodeMirror/ClipboardEvent/FileChooser; mocked IPC. Not native persistence or acceptance.'},null,2));
 console.log(JSON.stringify({passed:checks.length,errors,scope:'browser regression with mocked IPC'}));
} catch(error) {fs.writeFileSync(path.join(dir,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,checks,errors},null,2));if(page)await page.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});throw error;}
finally {await browser?.close();await server?.close();}

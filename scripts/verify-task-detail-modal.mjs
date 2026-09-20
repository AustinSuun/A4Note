import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const dir=path.resolve('.tmp/task-detail-regression',String(process.pid));
fs.mkdirSync(dir,{recursive:true});
let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++};
try {
  async function load(name) {
    const source=fs.readFileSync('src/features/taskboard/'+name+'.tsx','utf8');
    const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/import ['"]\.\/taskboard-dialog\.css['"];?/g,'');
    const file=path.join(dir,name+'.mjs');fs.writeFileSync(file,output);return import(pathToFileURL(file).href);
  }
  const {canPreviewTaskImage,TaskAttachments}=await load('TaskImageViewer');
  const {TaskDetailDialog}=await load('TaskDetailDialog');
  const sample={id:'file',task_id:'task',name:'<script>test</script>.png',mime:'image/png',size:123,purpose:'reference',caption:'说明 <script>test</script>',created_at:'2026-09-19',created_by:'fixture',retired_at:null};
  for(const mime of ['image/png','image/jpeg','image/gif','image/webp','image/bmp','image/avif'])check(canPreviewTaskImage({...sample,mime}),'Supported raster '+mime);
  for(const mime of ['image/svg+xml','text/html','application/xhtml+xml','application/pdf','image/jpg','image/unknown','text/plain','image/png;evil=true'])check(!canPreviewTaskImage({...sample,mime}),'Reject active/unknown '+mime);
  const client={file:()=>{throw Error('Server rendering must not read attachments')}};
  const render=props=>renderToStaticMarkup(React.createElement(TaskAttachments,{files:[sample],client,readonly:false,remove:()=>{},...props}));
  let html=render({});
  check(!html.includes('<script>'),'Names and captions are escaped');
  check(html.includes('查看大图'),'Raster opens internal viewer');
  check(!html.includes('target="_blank"'),'No external image browser');
  check(html.includes('不自动推断修改前后'),'Comparison does not infer before/after from purpose');
  check(html.includes('标记替代'),'Mutable active attachment preserves replacement action');
  check(!render({readonly:true}).includes('标记替代'),'Archived/busy attachment stays read-only');
  check(!render({files:[{...sample,retired_at:'2026-09-19'}]}).includes('标记替代'),'Already retired attachment is not replaced twice');
  html=render({files:[{...sample,mime:'image/svg+xml'}]});
  check(!html.includes('查看大图'),'SVG does not get preview controls');
  check(!html.includes('<img'),'SVG is never inlined');
  check(html.includes('下载'),'Unsafe preview still allows authenticated download');
  html=renderToStaticMarkup(React.createElement(TaskDetailDialog,{title:'任务详情',busy:false,onClose:()=>{},children:'说明',footer:'验收操作',error:'请求冲突'}));
  check(html.startsWith('<dialog'),'Native modal semantics');
  check(html.includes('tb-dialog-body')&&html.includes('tb-detail-footer'),'Separate body scrolling and fixed footer');
  check(html.includes('role="alert"')&&html.includes('请求冲突'),'Errors remain visible in modal');
  console.log(`Task detail modal regression passed (${checks} assertions)`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}

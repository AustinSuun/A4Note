import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {createAcceptanceFixtures,verifyFixtureInputs} from '../lib/acceptance-fixtures.mjs';
function setup(t){
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'a4-fixture-policy-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const taskId=randomUUID(),runId=randomUUID();
  return {root,options:{authorizedProjectRoot:root,taskId,runId,needsNotes:true,note:'# 临时笔记\r\n\r\n保存检查\r\n',sample:'# 样式样例\n\n> 引用\n\n- 列表\n',environment:'仅隔离测试，不打开用户实例',binding:{taskId,deliveryRevision:2,criteriaRevision:3,buildSha256:'a'.repeat(64)}}};
}
test('no notes request creates nothing, even when supplied paths would be invalid',t=>{
  const {root,options}=setup(t);
  for(const needsNotes of [false,undefined,'true',1]) assert.equal(createAcceptanceFixtures({...options,needsNotes}).created,false);
  assert.deepEqual(fs.readdirSync(root),[]);
});
test('explicit request creates UTF8 LF notes, empty screenshot directory and honest unexecuted report',t=>{
  const {root,options}=setup(t);fs.writeFileSync(path.join(root,'real-note.md'),'真实笔记');
  fs.writeFileSync(path.join(root,'.gitignore'),'keep-me');
  const manifest=createAcceptanceFixtures(options);
  assert.equal(manifest.created,true);assert.equal(manifest.files.length,3);assert.equal(manifest.inputs.length,2);
  assert.deepEqual(fs.readdirSync(path.join(manifest.directory,'screenshots')),[]);
  assert.equal(fs.readFileSync(path.join(manifest.directory,'测试笔记.md'),'utf8'),'# 临时笔记\n\n保存检查\n');
  assert.match(fs.readFileSync(path.join(manifest.directory,'验收报告.md'),'utf8'),/未执行/);
  assert.ok(verifyFixtureInputs(root,manifest).every(x=>x.unchanged));
  assert.equal(fs.readFileSync(path.join(root,'real-note.md'),'utf8'),'真实笔记');
  assert.equal(fs.readFileSync(path.join(root,'.gitignore'),'utf8'),'keep-me');
});
test('existing run is never overwritten; different run preserves earlier bytes',t=>{
  const {root,options}=setup(t),first=createAcceptanceFixtures(options);
  const before=first.files.map(f=>fs.readFileSync(path.join(root,f.path)));
  assert.throws(()=>createAcceptanceFixtures({...options,note:'overwrite'}),{code:'EEXIST'});
  const second=createAcceptanceFixtures({...options,runId:randomUUID()});assert.notEqual(first.directory,second.directory);
  first.files.forEach((f,i)=>assert.deepEqual(fs.readFileSync(path.join(root,f.path)),before[i]));
});
test('path traversal, separators, ADS and non-UUID identifiers rejected before writes',t=>{
  const {root,options}=setup(t);
  for(const id of ['..','../../outside','/tmp/escape','C:\\escape','test:stream','%2e%2e',options.taskId+'/../x']){
    assert.throws(()=>createAcceptanceFixtures({...options,taskId:id}));
    assert.throws(()=>createAcceptanceFixtures({...options,runId:id}));
  }
  assert.deepEqual(fs.readdirSync(root),[]);
});
test('missing scope, invalid binding and invalid text rejected before writes',t=>{
  const {root,options}=setup(t);
  for(const changes of [{authorizedProjectRoot:'.'}, {binding:{...options.binding,taskId:randomUUID()}},
    {binding:{...options.binding,buildSha256:'bad'}},{note:''},{sample:'a\0b'},{note:'x'.repeat(64001)},{environment:''}])
    assert.throws(()=>createAcceptanceFixtures({...options,...changes}));
  assert.deepEqual(fs.readdirSync(root),[]);
});
test('directory junction/symlink at each fixture ancestor is rejected without external writes',async t=>{
  for(const depth of [0,1,2]) await t.test(`ancestor depth ${depth}`,t=>{
    const {root,options}=setup(t),outside=path.join(root,'outside');fs.mkdirSync(outside);
    const parts=['.a4-tests','acceptance',options.taskId];let parent=root;
    for(let i=0;i<depth;i++){parent=path.join(parent,parts[i]);fs.mkdirSync(parent);}
    const link=path.join(parent,parts[depth]);
    try {fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');}
    catch(e){if(['EPERM','EACCES','ENOSYS'].includes(e.code)){t.skip('平台不允许创建测试链接：'+e.code);return;}throw e;}
    assert.throws(()=>createAcceptanceFixtures(options));assert.deepEqual(fs.readdirSync(outside),[]);
  });
});
test('project root cannot be a symlink/junction',t=>{
  const {root,options}=setup(t),actual=path.join(root,'actual'),link=path.join(root,'alias');fs.mkdirSync(actual);
  try{fs.symlinkSync(actual,link,process.platform==='win32'?'junction':'dir');}
  catch(e){if(['EPERM','EACCES','ENOSYS'].includes(e.code)){t.skip('平台不允许创建链接');return;}throw e;}
  assert.throws(()=>createAcceptanceFixtures({...options,authorizedProjectRoot:link}));assert.deepEqual(fs.readdirSync(actual),[]);
});
test('post-run verification detects input edits and rejects forged manifest paths',t=>{
  const {root,options}=setup(t),manifest=createAcceptanceFixtures(options);
  fs.appendFileSync(path.join(manifest.directory,'测试笔记.md'),'changed');
  assert.equal(verifyFixtureInputs(root,manifest)[0].unchanged,false);
  const bad=structuredClone(manifest);bad.inputs[0].path='../outside';assert.throws(()=>verifyFixtureInputs(root,bad));
  const duplicate=structuredClone(manifest);duplicate.inputs[1]=duplicate.inputs[0];assert.throws(()=>verifyFixtureInputs(root,duplicate));
});
test('symlinked input cannot substitute evidence during revalidation',t=>{
  const {root,options}=setup(t),manifest=createAcceptanceFixtures(options),file=path.join(manifest.directory,'测试笔记.md');
  const other=path.join(root,'other.md');fs.writeFileSync(other,'not evidence');fs.unlinkSync(file);
  try {fs.symlinkSync(other,file,'file');}catch(e){if(['EPERM','EACCES','ENOSYS'].includes(e.code)){t.skip('平台不允许文件符号链接');return;}throw e;}
  assert.throws(()=>verifyFixtureInputs(root,manifest));assert.equal(fs.readFileSync(other,'utf8'),'not evidence');
});

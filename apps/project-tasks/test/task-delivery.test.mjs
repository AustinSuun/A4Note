import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../lib/store.mjs';
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'delivery-')),root=path.join(dir,'repo');fs.mkdirSync(root);
 git(root,'init','-b','main');git(root,'config','core.autocrlf','false');git(root,'config','user.name','Test');git(root,'config','user.email','test@localhost');
 fs.writeFileSync(path.join(root,'a.txt'),'base\n');git(root,'add','a.txt');git(root,'commit','-m','base');const base=git(root,'rev-parse','HEAD');
 git(root,'checkout','-b','task');fs.writeFileSync(path.join(root,'a.txt'),'delivery\n');git(root,'commit','-am','task');const commit=git(root,'rev-parse','HEAD');
 const store=new Store(path.join(dir,'data'),'Test',{projectRoot:root,gitVerifyArgv:[process.execPath,'-e','console.log("candidate verification passed")']});
 const human=store.auth(store.access.operatorToken),joined=store.join(store.access.enrollmentToken,{alias:'worker'}),worker=store.auth(joined.sessionToken);
 const delivery={kind:'code',commit,baseCommit:base,sourceRef:'refs/heads/task',paths:['a.txt'],validation:'fixture expected content test'};
 function submit(input=delivery){let t=store.create(human,{title:'test'});t=store.update(worker,t.id,{action:'claim',revision:t.revision});return store.update(worker,t.id,{action:'submit',revision:t.revision,result:'tested',delivery:input});}
 const archive=t=>store.update(human,t.id,{action:'archive',revision:t.revision});
 return {dir,root,store,human,worker,base,commit,delivery,submit,archive,close(){store.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

test('agent merges before submit; archive only reconciles without executing verifier',()=>{
 const f=fixture();try{
  assert.throws(()=>f.submit(),/先验证并合并/);
  assert.equal(git(f.root,'rev-parse','main'),f.base);
  git(f.root,'checkout','main');git(f.root,'merge','--ff-only','task');
  const marker=path.join(f.dir,'must-not-run');
  f.store.gitVerifyArgv=[process.execPath,'-e',`require('fs').writeFileSync(${JSON.stringify(marker)},'BAD')`];
  let t=f.submit();const before=git(f.root,'show-ref');
  t=f.archive(t);assert.equal(t.status,'archived');assert.equal(t.integration.status,'already_on_target');
  assert.equal(t.integration.mode,'agent_owned');assert.equal(git(f.root,'show-ref'),before);assert(!fs.existsSync(marker));
 }finally{f.close();}
});
test('archive preserves dirty main and untracked data',()=>{
 const f=fixture();try{
  git(f.root,'checkout','main');git(f.root,'merge','--ff-only','task');let t=f.submit();
  fs.writeFileSync(path.join(f.root,'a.txt'),'unsaved');fs.writeFileSync(path.join(f.root,'private.txt'),'keep');
  const status=git(f.root,'status','--porcelain');t=f.archive(t);
  assert.equal(t.status,'archived');assert.equal(git(f.root,'status','--porcelain'),status);
  assert.equal(fs.readFileSync(path.join(f.root,'a.txt'),'utf8'),'unsaved');
  assert.equal(fs.readFileSync(path.join(f.root,'private.txt'),'utf8'),'keep');
 }finally{f.close();}
});
test('legacy unmerged delivery archives truthfully without moving refs',()=>{
 const f=fixture();try{
  // Existing event schema from the former version, not a new valid submission.
  let t=f.submit({kind:'none',reason:'synthetic legacy setup'});
  f.store.event(t.id,f.worker.id,'task.delivery',{...f.delivery,repository:fs.realpathSync(f.root),deliveryRevision:t.delivery_revision,specRevision:t.spec_revision});
  const before=git(f.root,'show-ref');t=f.archive(t);assert.equal(t.status,'archived');
  assert.equal(t.integration.status,'blocked');assert.match(t.integration.error,/归档不会代为合并/);assert.equal(git(f.root,'show-ref'),before);
 }finally{f.close();}
});
test('unknown, noncode and unavailable Git never fabricate a successful merge',()=>{
 const f=fixture();try{
  let t=f.store.create(f.human,{title:'old'});t=f.store.update(f.worker,t.id,{action:'claim',revision:t.revision});
  t=f.store.update(f.worker,t.id,{action:'submit',revision:t.revision,result:'old result'});
  t=f.archive(t);assert.equal(t.status,'archived');assert.equal(t.integration.status,'not_configured');
  t=f.archive(f.submit({kind:'none',reason:'audit only'}));assert.equal(t.integration.status,'not_applicable');
  git(f.root,'checkout','main');git(f.root,'merge','--ff-only','task');t=f.submit();
  f.store.projectRoot=path.join(f.dir,'missing');t=f.archive(t);assert.equal(t.status,'archived');assert.equal(t.integration.status,'failed');
 }finally{f.close();}
});
test('immutable scope checks and worker archive prohibition remain',()=>{
 const f=fixture();try{
  git(f.root,'checkout','main');git(f.root,'merge','--ff-only','task');
  for(const change of [{paths:['wrong']},{sourceRef:'refs/heads/missing'},{commit:'bad'},{validation:''}])assert.throws(()=>f.submit({...f.delivery,...change}));
  const t=f.submit();assert.throws(()=>f.store.update(f.worker,t.id,{action:'archive',revision:t.revision}),/仅用户/);
 }finally{f.close();}
});
test('delivery module contains no Git mutation or verifier execution path',()=>{
 const source=fs.readFileSync(new URL('../lib/task-delivery.mjs',import.meta.url),'utf8');
 assert(!source.includes("'update-ref'"));assert(!source.includes("'checkout'"));assert(!source.includes("'merge',"));assert(!source.includes('store.gitVerifyArgv'));
});

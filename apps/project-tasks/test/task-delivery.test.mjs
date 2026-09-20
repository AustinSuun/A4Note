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
test('immutable delivery, successful local merge and already-on-target reconciliation',()=>{
 const f=fixture();try{let t=f.submit();assert.equal(t.delivery.commit,f.commit);assert.equal(git(f.root,'rev-parse','main'),f.base);
 t=f.archive(t);assert.equal(t.status,'archived');assert.equal(t.integration.status,'merged');assert.equal(t.integration.remote,'not_pushed');assert.equal(git(f.root,'merge-base',f.commit,'main'),f.commit);
 const second=f.archive(f.submit());assert.equal(second.integration.status,'already_on_target');assert.equal(second.integration.after,t.integration.after);
 }finally{f.close();}
});
test('checked-out clean main updates working files; dirty main blocks without losing work',()=>{
 const f=fixture();try{let t=f.submit();git(f.root,'checkout','main');fs.writeFileSync(path.join(f.root,'a.txt'),'unsaved');
 t=f.archive(t);assert.equal(t.status,'review');assert.match(t.integration.error,/未提交/);assert.equal(fs.readFileSync(path.join(f.root,'a.txt'),'utf8'),'unsaved');assert.equal(git(f.root,'rev-parse','main'),f.base);
 // Only restore our synthetic test data, never a user worktree.
 fs.writeFileSync(path.join(f.root,'a.txt'),'base\n');t=f.archive(t);assert.equal(t.status,'archived',JSON.stringify(t.integration));assert.equal(fs.readFileSync(path.join(f.root,'a.txt'),'utf8').replace(/\r\n/g,'\n'),'delivery\n');
 }finally{f.close();}
});
test('source identity, paths and full hashes required, no implicit dirty HEAD delivery',()=>{
 const f=fixture();try{
 for(const input of [{...f.delivery,commit:'abc'},{...f.delivery,sourceRef:'refs/heads/main'},{...f.delivery,paths:['other']},{...f.delivery,validation:''}])assert.throws(()=>f.submit(input),e=>e.status===400);
 const t=f.archive(f.submit(undefined)); // JS default argument means code; test unknown separately below
 assert.equal(t.status,'archived');
 }finally{f.close();}
});
test('missing or failed validation stays review; retry records acceptance and integrates only after success',()=>{
 const f=fixture();try{let t=f.submit();f.store.gitVerifyArgv=null;t=f.archive(t);assert.equal(t.status,'review');assert.match(t.integration.error,/未配置/);
 f.store.gitVerifyArgv=[process.execPath,'-e','process.exit(7)'];t=f.archive(t);assert.equal(t.status,'review');assert.equal(git(f.root,'rev-parse','main'),f.base);
 f.store.gitVerifyArgv=[process.execPath,'-e','console.log("ok")'];t=f.archive(t);assert.equal(t.status,'archived');
 }finally{f.close();}
});
test('conflicts preserve main and include paths; no-code tasks explicitly skip Git',()=>{
 const f=fixture();try{let t=f.submit();git(f.root,'checkout','main');fs.writeFileSync(path.join(f.root,'a.txt'),'conflict\n');git(f.root,'commit','-am','other change');const main=git(f.root,'rev-parse','HEAD');git(f.root,'checkout','task');
 t=f.archive(t);assert.equal(t.status,'review');assert.match(t.integration.error,/a.txt/);assert.equal(git(f.root,'rev-parse','main'),main);
 const noCode=f.archive(f.submit({kind:'none',reason:'只读审计报告，无产品代码'}));assert.equal(noCode.status,'archived');assert.equal(noCode.integration.status,'not_applicable');
 }finally{f.close();}
});
test('Git success / SQLite rollback reconciles on retry, stale delivery cannot reuse acceptance',()=>{
 const f=fixture();try{let t=f.submit();const event=f.store.event.bind(f.store);let injected=true;
 f.store.event=(id,actor,kind,payload)=>{if(kind==='task.integration'&&injected){injected=false;throw Error('simulated database failure');}return event(id,actor,kind,payload);};
 assert.throws(()=>f.archive(t),/database/);assert.equal(f.store.get(t.id).status,'review');assert.equal(git(f.root,'merge-base',f.commit,'main'),f.commit);
 t=f.archive(t);assert.equal(t.integration.status,'already_on_target');
 let changed=f.submit();changed=f.store.update(f.human,changed.id,{action:'edit',revision:changed.revision,description:'new requirements'});assert.throws(()=>f.archive(changed),e=>e.status===409);
 }finally{f.close();}
});

test('moving task branch cannot smuggle later commits into an accepted immutable delivery',()=>{
 const f=fixture();try{const t=f.submit();fs.writeFileSync(path.join(f.root,'unrelated.txt'),'do not integrate');git(f.root,'add','unrelated.txt');git(f.root,'commit','-m','later unrelated');
 const result=f.archive(t);assert.equal(result.status,'archived');assert.throws(()=>git(f.root,'cat-file','-e','main:unrelated.txt'));assert.equal(git(f.root,'merge-base',f.commit,'main'),f.commit);
 }finally{f.close();}
});
test('real CLI delivery JSON reaches HTTP API and worker cannot perform acceptance',async()=>{
 const f=fixture();const {createTaskServer}=await import('../server.mjs');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const {fileURLToPath}=await import('node:url');
 const app=createTaskServer({dataDir:path.join(f.dir,'http-data'),projectRoot:f.root,gitVerifyArgv:[process.execPath,'-e','console.log("verified")']});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 try{
 const url='http://127.0.0.1:'+app.server.address().port;const env={...process.env,TASKS_URL:url,TASKS_DATA_DIR:path.join(f.dir,'http-data')};for(const k of ['TASKS_PROJECT_ROOT','TASKS_EXPECTED_PROJECT_ID','TASKS_SESSION_TOKEN','TASKS_SESSION_FILE'])delete env[k];
 const cli=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../cli.mjs',import.meta.url)),...args],{env})).stdout);
 const session=path.join(f.dir,'session.json');await cli('join','--alias','CLI worker','--session',session);const human=app.store.auth(app.store.access.operatorToken);
 let t=app.store.create(human,{title:'CLI immutable delivery'});t=await cli('claim',t.id,'--revision',String(t.revision),'--session',session);
 const manifest=path.join(f.dir,'delivery.json');fs.writeFileSync(manifest,JSON.stringify(f.delivery));
 t=await cli('submit',t.id,'--revision',String(t.revision),'--text','CLI tested','--delivery-json',manifest,'--session',session);assert.equal(t.delivery.commit,f.commit);
 const token=JSON.parse(fs.readFileSync(session,'utf8')).sessionToken;
 let response=await fetch(url+'/api/tasks/'+t.id,{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'archive',revision:t.revision})});assert.equal(response.status,403);
 response=await fetch(url+'/api/tasks/'+t.id,{method:'PATCH',headers:{Authorization:'Bearer '+app.store.access.operatorToken,'Content-Type':'application/json'},body:JSON.stringify({action:'archive',revision:t.revision})});assert.equal(response.status,200);t=await response.json();assert.equal(t.integration.status,'merged');assert.equal(t.status,'archived');
 }finally{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app.store.close();f.close();}
});
test('repository lock, unknown delivery and validation-mutated source fail closed',()=>{
 const f=fixture();try{let t=f.submit();const lock=path.join(f.root,'.git','a4note-task-integration.lock');fs.writeFileSync(lock,'synthetic held lock');t=f.archive(t);assert.equal(t.status,'review');assert.match(t.integration.error,/合并锁/);fs.unlinkSync(lock);
 f.store.gitVerifyArgv=[process.execPath,'-e','require("fs").writeFileSync("a.txt","changed by validation")'];t=f.archive(t);assert.equal(t.status,'review');assert.equal(git(f.root,'rev-parse','main'),f.base);
 let unknown=f.store.create(f.human,{title:'legacy unknown'});unknown=f.store.update(f.worker,unknown.id,{action:'claim',revision:unknown.revision});unknown=f.store.update(f.worker,unknown.id,{action:'submit',revision:unknown.revision,result:'no metadata'});unknown=f.archive(unknown);assert.equal(unknown.status,'review');assert.equal(unknown.integration.status,'blocked');
 }finally{f.close();}
});

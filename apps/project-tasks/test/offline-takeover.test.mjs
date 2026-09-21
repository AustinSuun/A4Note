import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store, agentPresence, AGENT_OFFLINE_AFTER_MS} from '../lib/store.mjs';
import {createTaskServer} from '../server.mjs';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
function fixture() {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'takeover-'));
 const store=new Store(dir); const human=store.auth(store.access.operatorToken);
 const worker=alias=>{const a=store.join(store.access.enrollmentToken,{alias});return {...store.auth(a.sessionToken),sessionToken:a.sessionToken};};
 const old=worker('旧'), next=worker('新'), other=worker('另一个');
 let t=store.create(human,{title:'中断交接'}); t=store.update(old,t.id,{action:'claim',revision:t.revision});
 const offline=()=>store.db.prepare('UPDATE agents SET last_seen=? WHERE id=?').run(new Date(Date.now()-AGENT_OFFLINE_AFTER_MS-1000).toISOString(),old.id);
 return {dir,store,human,old,next,other,t,offline,close(){store.db.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
const takeover = {action:'takeover',userAuthorized:true,workspaceChecked:true,reason:'用户明确要求接替；独立工作区已核验'};
test('presence is conservative on missing, invalid or future timestamps',()=>{
 assert.equal(agentPresence(undefined),'unknown');assert.equal(agentPresence('bad'),'unknown');
 assert.equal(agentPresence(new Date(Date.now()+60000).toISOString()),'unknown');
 assert.equal(agentPresence(new Date().toISOString()),'online');
 assert.equal(agentPresence(new Date(Date.now()-120001).toISOString()),'offline');
});
test('authorization, state, atomic revision and old owner fencing with preserved handoff',()=>{
 const f=fixture();const {store,old,next,other,human}=f;
 try {
 let t=store.update(old,f.t.id,{action:'handoff',revision:f.t.revision,handoff:{completed:'实现A',remaining:'测试B',worktree:'独立路径',uncommittedChanges:'未提交，待盘点'}});
 assert.equal(store.detail(t.id).handoff.handoff.completed,'实现A');
 assert.throws(()=>store.update(next,t.id,{...takeover,revision:t.revision}),/在线|不确定/);
 f.offline();
 assert.throws(()=>store.update(next,t.id,{...takeover,revision:t.revision,userAuthorized:false}),/授权/);
 assert.throws(()=>store.update(next,t.id,{...takeover,revision:t.revision,workspaceChecked:false}),/隔离/);
 assert.throws(()=>store.update(next,t.id,{...takeover,revision:t.revision,reason:' '}),/授权说明/);
 assert.throws(()=>store.update(human,t.id,{...takeover,revision:t.revision}),/执行Agent/);
 const revision=t.revision;t=store.update(next,t.id,{...takeover,revision});
 assert.equal(t.status,'in_progress');assert.equal(t.owner,next.id);assert.equal(t.claimed_spec,null);
 assert.equal(t.handoff.author,old.id);assert.equal(t.handoff.handoff.remaining,'测试B');
 assert.ok(t.events.some(e=>e.kind==='task.takeover_authorization'&&JSON.parse(e.payload).fromOwner===old.id));
 assert.throws(()=>store.update(other,t.id,{...takeover,revision}),/更新/);
 for(const action of ['progress','submit','release','acknowledge','handoff'])
  assert.throws(()=>store.update(old,t.id,{action,revision:t.revision,progress:'旧',result:'旧',writesStopped:true,handoff:{remaining:'旧'}}),e=>e.status===403);
 store.heartbeat(old);assert.equal(store.get(t.id).owner,next.id);
 assert.throws(()=>store.update(next,t.id,{action:'submit',revision:t.revision,result:'未重读'}),/读取/);
 t=store.update(next,t.id,{action:'acknowledge',revision:t.revision});
 t=store.update(next,t.id,{action:'submit',revision:t.revision,result:'已重读并验证'});
 assert.equal(t.status,'review');assert.throws(()=>store.update(other,t.id,{...takeover,revision:t.revision}),/进行中/);
 }finally{f.close();}
});
test('unknown owner heartbeat and invalid handoff fail closed, no mutation',()=>{
 const f=fixture();try{
 f.store.db.prepare("UPDATE agents SET last_seen='invalid' WHERE id=?").run(f.old.id);
 assert.throws(()=>f.store.update(f.next,f.t.id,{...takeover,revision:f.t.revision}),/不确定/);
 for(const h of [{},[],{unknown:'x'},{completed:42}]) assert.throws(()=>f.store.update(f.old,f.t.id,{action:'handoff',revision:f.t.revision,handoff:h}),e=>e.status===400);
 assert.equal(f.store.get(f.t.id).revision,f.t.revision);assert.equal(f.store.detail(f.t.id).handoff,null);
 }finally{f.close();}
});
test('HTTP concurrency, CLI takeover and real MCP handoff',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'takeover-api-'));const app=createTaskServer({dataDir:dir});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+app.server.address().port;
 const env={...process.env,TASKS_DATA_DIR:dir,TASKS_URL:url};
 for(const k of ['TASKS_PROJECT_ROOT','TASKS_EXPECTED_PROJECT_ID','TASKS_SESSION_TOKEN','TASKS_SESSION_FILE'])delete env[k];
 const cli=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,[path.join(here,'../cli.mjs'),...args],{env})).stdout);
 const post=async(t,actor,body)=>{const r=await fetch(url+'/api/tasks/'+t.id,{method:'PATCH',headers:{Authorization:'Bearer '+actor.sessionToken,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const human=app.store.auth(app.store.access.operatorToken);
 const old=app.store.join(app.store.access.enrollmentToken,{alias:'离线'});
 const a=app.store.join(app.store.access.enrollmentToken,{alias:'A'}),b=app.store.join(app.store.access.enrollmentToken,{alias:'B'});
 const create=()=>{let t=app.store.create(human,{title:'实际协议'});return app.store.update(app.store.auth(old.sessionToken),t.id,{action:'claim',revision:t.revision});};
 const offline=()=>app.store.db.prepare('UPDATE agents SET last_seen=? WHERE id=?').run(new Date(Date.now()-180000).toISOString(),old.id);
 let child;
 try{
 let t=create();offline();const race=await Promise.all([post(t,a,{...takeover,revision:t.revision}),post(t,b,{...takeover,revision:t.revision})]);
 assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 const session=path.join(dir,'worker.json');await cli('join','--alias','命令行','--session',session);
 t=create();offline();t=await cli('takeover',t.id,'--revision',String(t.revision),'--user-authorized','--workspace-checked','--text','用户指定，已隔离','--session',session);
 assert.equal(t.status,'in_progress');
 const saved=JSON.parse(fs.readFileSync(session,'utf8'));
 child=spawn(process.execPath,[path.join(here,'../mcp.mjs')],{env:{...env,TASKS_SESSION_TOKEN:saved.sessionToken},stdio:['pipe','pipe','pipe']});
 const waiting=new Map();let seq=0;
 readline.createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);waiting.get(m.id)?.(m);});
 const rpc=(name,args)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>reject(Error('MCP timeout')),10000);waiting.set(id,m=>{clearTimeout(timer);waiting.delete(id);resolve(m);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})+'\n');});
 const response=await rpc('update_task',{id:t.id,revision:t.revision,action:'handoff',handoff:{remaining:'真实MCP写入交接'}});
 assert.equal(response.result.isError,undefined,JSON.stringify(response));
 assert.equal(app.store.detail(t.id).handoff.handoff.remaining,'真实MCP写入交接');
 // Second isolated project must not resolve a task from the first.
 const otherDir=path.join(dir,'other');const otherStore=new Store(otherDir);
 try{assert.throws(()=>otherStore.get(t.id),e=>e.status===404);}finally{otherStore.db.close();}
 }finally{child?.kill();await new Promise(r=>app.server.close(r));app.store.db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

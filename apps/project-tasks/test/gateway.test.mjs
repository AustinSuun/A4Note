import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createTaskGateway,projectDirectory} from '../gateway.mjs';
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
test('one listener serves isolated projects; same-project reuse, cross-project credentials and control escalation denied',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'a4-hub-test-'));const roots=['A','B'].map(n=>path.join(temp,n));roots.forEach(p=>fs.mkdirSync(p));
 const gateway=createTaskGateway({stateDir:path.join(temp,'hub'),projectsHome:path.join(temp,'private')});
 try{
  const base=await gateway.listen(0),a=await gateway.register(roots[0]),b=await gateway.register(roots[1]);
  assert.notEqual(a.projectId,b.projectId);assert.equal(new URL(a.url).origin,base);assert.equal(new URL(b.url).origin,base);
  const call=(connection,endpoint,token=connection.operatorToken,method='GET',body)=>fetch(connection.url+'/api'+endpoint,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.equal((await call(a,'/tasks',a.operatorToken,'POST',{title:'A-only'})).status,201);
  assert.equal((await call(b,'/tasks',b.operatorToken,'POST',{title:'B-only'})).status,201);
  assert.deepEqual((await (await call(a,'/snapshot')).json()).tasks.map(t=>t.title),['A-only']);
  assert.deepEqual((await (await call(b,'/snapshot')).json()).tasks.map(t=>t.title),['B-only']);
  assert.equal((await call(b,'/snapshot',a.operatorToken)).status,401);
  const worker=await (await call(a,'/join',a.operatorToken,'POST',{alias:'A-worker'})).json();
  assert.equal((await call(b,'/snapshot',worker.sessionToken)).status,401);
  const denied=await fetch(base+'/api/gateway/register',{method:'POST',headers:{Authorization:'Bearer '+a.operatorToken,'Content-Type':'application/json'},body:JSON.stringify({projectRoot:roots[1]})});assert.equal(denied.status,403);
  assert.equal((await fetch(base+'/api/gateway/register',{method:'POST',headers:{Authorization:'Bearer '+gateway.access.token,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({projectRoot:roots[1]})})).status,403);
  const again=await Promise.all([gateway.register(roots[0]),gateway.register(roots[0])]);assert.ok(again.every(x=>x.projectId===a.projectId&&x.url===a.url));
  assert.equal(JSON.parse(fs.readFileSync(path.join(projectDirectory(roots[0],path.join(temp,'private')),'connection.json'))).url,a.url);
  assert.equal((await fetch(base+'/api/snapshot',{headers:{Authorization:'Bearer '+a.operatorToken}})).status,404);
  assert.equal((await fetch(base+'/projects/00000000-0000-0000-0000-000000000000/api/snapshot',{headers:{Authorization:'Bearer '+a.operatorToken}})).status,404);
 }finally{await gateway.close();await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});
test('occupied preferred port selects one free shared port without contacting or stopping its owner',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'a4-hub-port-'));let requests=0;
 const other=http.createServer((req,res)=>{requests++;res.end('unrelated');});const port=await listen(other);
 const gateway=createTaskGateway({stateDir:path.join(temp,'hub'),projectsHome:path.join(temp,'private')});
 try{const base=await gateway.listen(port);assert.notEqual(new URL(base).port,String(port));assert.equal(requests,0);assert.equal(other.listening,true);}
 finally{await gateway.close();await new Promise(r=>other.close(r));await fs.promises.rm(temp,{recursive:true,force:true});}
});

test('registry restart preserves identity, tasks, credentials and attachment bytes',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'a4-hub-restart-')),root=path.join(temp,'project');fs.mkdirSync(root);
 const options={stateDir:path.join(temp,'hub'),projectsHome:path.join(temp,'private')};let gateway=createTaskGateway(options);
 try{
  await gateway.listen(0);const first=await gateway.register(root);
  const call=(url,route,method='GET',body)=>fetch(url+'/api'+route,{method,headers:{Authorization:'Bearer '+first.operatorToken,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const task=await (await call(first.url,'/tasks','POST',{title:'persistent'})).json();
  const data=Buffer.from('isolated evidence bytes');
  const attached=await (await call(first.url,'/tasks/'+task.id+'/attachments','POST',{revision:task.revision,name:'evidence.txt',base64:data.toString('base64'),purpose:'reference'})).json();
  assert.equal(attached.attachments.length,1);
  await gateway.close();gateway=createTaskGateway(options);const base=await gateway.listen(0);
  const lazy=base+'/projects/'+first.projectId;
  assert.equal((await (await call(lazy,'/snapshot')).json()).tasks[0].id,task.id);
  const next=await gateway.register(root);assert.equal(next.projectId,first.projectId);assert.equal(next.operatorToken,first.operatorToken);
  assert.deepEqual(Buffer.from(await (await call(next.url,'/attachments/'+attached.attachments[0].id)).arrayBuffer()),data);
  assert.equal((await fetch(next.url+'/api/snapshot',{headers:{Authorization:'Bearer '+first.operatorToken,Origin:'https://untrusted.invalid'}})).status,403);
 }finally{await gateway.close();await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});

test('corrupt registry and project connection fail closed without overwriting metadata or database',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'a4-hub-corrupt-'));const stateDir=path.join(temp,'hub');fs.mkdirSync(stateDir);
 try{
  const file=path.join(stateDir,'projects.json');fs.writeFileSync(file,'{broken');
  assert.throws(()=>createTaskGateway({stateDir}),/损坏/);assert.equal(fs.readFileSync(file,'utf8'),'{broken');fs.unlinkSync(file);
  const root=path.join(temp,'project');fs.mkdirSync(root);const projectsHome=path.join(temp,'private'),dir=projectDirectory(root,projectsHome);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'tasks.sqlite'),'unchanged sentinel');fs.writeFileSync(path.join(dir,'connection.json'),'{broken');
  const gateway=createTaskGateway({stateDir,projectsHome});
  try{await gateway.listen(0);await assert.rejects(gateway.register(root),/损坏/);assert.equal(fs.readFileSync(path.join(dir,'tasks.sqlite'),'utf8'),'unchanged sentinel');}
  finally{await gateway.close();}
 }finally{await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});

import {ensureStarted} from '../bootstrap.mjs';
import {ensureGatewayProject} from '../gateway-bootstrap.mjs';
import {resolveSessionConnection} from '../lib/agent-client.mjs';
async function stopOwn(pid){if(!pid)return;try{process.kill(pid);}catch{}for(let i=0;i<80;i++){try{process.kill(pid,0);}catch{return;}await new Promise(r=>setTimeout(r,50));}throw Error('isolated child did not stop');}
test('running legacy process is proxied, never migrated or stopped; original connection remains intact',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'a4-hub-legacy-')),root=path.join(temp,'project');fs.mkdirSync(root);
 const projectsHome=path.join(temp,'private'),dir=projectDirectory(root,projectsHome),gateway=createTaskGateway({stateDir:path.join(temp,'hub'),projectsHome});let pid;
 try{
  const slot=http.createServer(),port=await listen(slot);await new Promise(r=>slot.close(r));
  const old=await ensureStarted({projectRoot:root,dataDir:dir,port});const original=fs.readFileSync(path.join(dir,'connection.json'));pid=JSON.parse(original).pid;
  await gateway.listen(0);const shared=await gateway.register(root);assert.equal(shared.legacyService,true);assert.equal(shared.projectId,old.projectId);
  assert.deepEqual(fs.readFileSync(path.join(dir,'connection.json')),original);
  const snapshot=await fetch(shared.url+'/api/snapshot',{headers:{Authorization:'Bearer '+shared.operatorToken}});assert.equal(snapshot.status,200);assert.equal((await snapshot.json()).project.id,old.projectId);
  await gateway.close();assert.equal((await fetch(old.url+'/api/health')).status,200);
 }finally{await gateway.close();await stopOwn(pid);await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});
test('real shared bootstrap concurrently opens two private projects; old session resolves by identity without rewriting',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'a4-hub-bootstrap-')),roots=['A','B'].map(x=>path.join(temp,x));roots.forEach(p=>fs.mkdirSync(p));
 const stateDir=path.join(temp,'hub'),projectsHome=path.join(temp,'private');let pid;
 const other=http.createServer((req,res)=>res.end('occupied'));const port=await listen(other);
 try{
  const [a,b]=await Promise.all(roots.map(projectRoot=>ensureGatewayProject({projectRoot,port,stateDir,projectsHome})));
  pid=JSON.parse(fs.readFileSync(path.join(stateDir,'gateway-connection.json'))).pid;
  assert.notEqual(a.projectId,b.projectId);assert.equal(new URL(a.url).origin,new URL(b.url).origin);assert.notEqual(new URL(a.url).port,String(port));
  assert.ok(!fs.readFileSync(path.join(stateDir,'startup.log'),'utf8').includes(a.operatorToken));
  assert.equal((await ensureGatewayProject({projectRoot:roots[0],port,stateDir,projectsHome})).projectId,a.projectId);
  const saved={url:'http://127.0.0.1:1',projectId:a.projectId};const copy=structuredClone(saved);
  assert.equal((await resolveSessionConnection({projectId:a.projectId,url:a.url},saved)).url,a.url);assert.deepEqual(saved,copy);
  await assert.rejects(resolveSessionConnection({projectId:b.projectId,url:b.url},saved),/会话不属于/);
 }finally{
  if(!pid&&fs.existsSync(path.join(stateDir,'gateway-connection.json')))pid=JSON.parse(fs.readFileSync(path.join(stateDir,'gateway-connection.json'))).pid;
  await stopOwn(pid);await new Promise(r=>other.close(r));await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:20,retryDelay:100});
 }
});

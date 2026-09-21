import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createTaskServer } from './server.mjs';
import { resolveDataDir, dataDirName } from './lib/data-dir.mjs';
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) { if(e.code==='ENOENT')return null; throw Object.assign(Error('私有连接元数据损坏，拒绝重建或迁移：'+path.basename(file)),{status:409}); } };
const hash = s => createHash('sha256').update(s).digest('hex');
const equal = (a,b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
const write = (file,value) => {const temp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});fs.renameSync(temp,file);};
export const projectDirectory = (root,home=path.join(os.homedir(),'.a4note-project-tasks')) => path.join(home,dataDirName(root));
const localUrl = value => typeof value === 'string' && /^http:\/\/127\.0\.0\.1:[0-9]+$/.test(value) && Number(value.split(':').at(-1))>0 && Number(value.split(':').at(-1))<=65535;

/** One public listener, independent per-project stores/credentials/event streams.
 * Control registration is local and authenticated with a private hub credential;
 * ordinary project credentials cannot register, enumerate, or select other stores.
 */
export const GATEWAY_VERSION=4;
const ACTIVE_AGENT_MS=5*60*1000;
export function createTaskGateway({stateDir,projectsHome=path.join(os.homedir(),'.a4note-project-tasks'), origins=['tauri://localhost','http://tauri.localhost','https://tauri.localhost'],onShutdownRequest}={}) {
  fs.mkdirSync(stateDir,{recursive:true,mode:0o700});
  const startedAt=new Date().toISOString();
  const canShutdown=typeof onShutdownRequest==='function';
  const accessPath=path.join(stateDir,'gateway-access.json');
  let access=read(accessPath);
  if(!access){access={id:randomUUID(),token:randomBytes(32).toString('base64url')};fs.writeFileSync(accessPath,JSON.stringify(access),{flag:'wx',mode:0o600});}
  if(typeof access?.id!=='string'||typeof access?.token!=='string'||access.token.length<32)throw Error('共享服务凭据损坏，未重建');
  const registryPath=path.join(stateDir,'projects.json');
  const registry=read(registryPath)??{};
  if(!registry||Array.isArray(registry)||typeof registry!=='object'||Object.values(registry).some(p=>typeof p?.root!=='string'||!path.isAbsolute(p.root)))throw Error('项目注册表损坏，未覆盖');
  const loaded=new Map(), pending=new Map();
  let base='';
  const hubAuthorized=req=>!req.headers.origin&&equal(String(req.headers.authorization??'').replace(/^Bearer /,''),access.token);
  // Activity summary for exit prompts: recent agents and open event streams per loaded project.
  const statusSummary=()=>({service:'a4note-task-gateway',id:access.id,pid:process.pid,startedAt,projects:[...loaded.values()].map(p=>{
    if(!p.app)return {id:p.id,root:p.root,name:path.basename(p.root),legacy:true};
    const snapshot=p.app.store.snapshot(),now=Date.now();
    return {id:p.id,root:p.root,name:path.basename(p.root),streams:p.app.streams(),activeAgents:snapshot.agents.filter(a=>now-Date.parse(a.last_seen)<=ACTIVE_AGENT_MS).map(a=>({alias:a.alias,role:a.role,last_seen:a.last_seen}))};
  })});
  const resolveProject=async (root) => {
    const dir=resolveDataDir(root,projectsHome),prior=read(path.join(dir,'connection.json')),credentials=read(path.join(dir,'access.json'));
    if(fs.existsSync(path.join(dir,'tasks.sqlite'))&&(!prior||!Number.isSafeInteger(prior.pid)||prior.pid<=0||typeof prior.url!=='string'||!credentials?.projectId||!credentials?.operatorToken))throw Object.assign(Error('已有项目缺少可核验连接身份；未打开或迁移数据库'),{status:409});
    // Never open/migrate a database while its legacy process is still serving it.
    if(prior?.pid && prior.pid!==process.pid && credentials && localUrl(prior.url)) {
      let alive=false;
      try {process.kill(prior.pid,0);alive=true;}catch(e){if(e.code==='EPERM')alive=true;}
      if(alive){
        let health;
        try {const r=await fetch(prior.url+'/api/health',{redirect:'error',signal:AbortSignal.timeout(1500)});health=r.ok?await r.json():null;}catch{}
        if(health?.service!=='a4note-project-tasks'||health.projectId!==credentials.projectId)
          throw Object.assign(Error('旧项目进程仍存在但身份不可确认；未停止进程或修改数据，请先检查旧服务。'),{status:409});
        return {root,dir,id:credentials.projectId,legacy:prior.url,capabilities:health.capabilities??{}};
      }
    }
    // A different live gateway must not concurrently own the same private store.
    if(prior?.pid && prior.pid!==process.pid && !localUrl(prior.url)) {
      try {process.kill(prior.pid,0);throw Object.assign(Error('项目仍由另一共享服务持有，请先确认服务切换。'),{status:409});}
      catch(e){if(e.status||e.code==='EPERM')throw e;}
    }
    const app=createTaskServer({dataDir:dir,project:path.basename(root),projectRoot:root,origins});
    return {root,dir,id:app.store.access.projectId,app};
  };
  const activate=async root=>{
    const existing=[...loaded.values()].find(p=>p.root===root);if(existing)return existing;
    if(pending.has(root))return pending.get(root);
    const promise=resolveProject(root).then(p=>{loaded.set(p.id,p);return p;});pending.set(root,promise);
    try{return await promise;}finally{pending.delete(root);}
  };
  const register=async projectRoot=>{
    if(typeof projectRoot!=='string'||!path.isAbsolute(projectRoot)||!fs.statSync(projectRoot).isDirectory())throw Object.assign(Error('项目目录无效'),{status:400});
    const root=path.resolve(projectRoot),p=await activate(root);
    const reused=Object.hasOwn(registry,p.id)||!!p.legacy;
    registry[p.id]={root};write(registryPath,registry);
    const url=base+'/projects/'+p.id;
    // Legacy service remains owner of its old connection file and agent sessions.
    // New projects/previously stopped services publish the project-scoped hub URL.
    if(!p.legacy)write(path.join(p.dir,'connection.json'),{url,projectRoot:root,pid:process.pid,gateway:true});
    const credentials=read(path.join(p.dir,'access.json'));
    return {url,projectId:p.id,projectRoot:root,operatorToken:credentials.operatorToken,reused,
      legacyService:!!p.legacy,capabilities:p.app?.store.snapshot().capabilities??p.capabilities};
  };
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const send=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
    try {
      const hostname=new URL('http://'+req.headers.host).hostname;
      if(!['127.0.0.1','localhost','[::1]'].includes(hostname))return send({error:'Host未授权'},403);
      const p=new URL(req.url,'http://localhost').pathname;
      if(p==='/api/gateway-health'&&req.method==='GET')return send({service:'a4note-task-gateway',version:GATEWAY_VERSION,id:access.id,pid:process.pid,startedAt,capabilities:{shutdown:canShutdown,status:true}});
      if(p==='/api/gateway/status'&&req.method==='GET'){
        if(!hubAuthorized(req))return send({error:'共享服务管理凭据无效'},403);
        return send(statusSummary());
      }
      if(p==='/api/gateway/shutdown'&&req.method==='POST'){
        // Only the local launcher holding the private hub credential may stop the shared service.
        if(req.headers.origin)return send({error:'停止仅允许本机启动桥'},403);
        if(!hubAuthorized(req))return send({error:'共享服务管理凭据无效'},403);
        let size=0,parts=[];for await(const c of req){size+=c.length;if(size>4096)return send({error:'请求过大'},413);parts.push(c);}
        let body={};if(parts.length){try{body=JSON.parse(Buffer.concat(parts));}catch{return send({error:'JSON无效'},400);}}
        if(!canShutdown)return send({error:'当前运行方式不支持远程停止'},409);
        const reason=String(body?.reason??'').slice(0,200);
        send({stopping:true,reason,...statusSummary()});
        setImmediate(()=>{try{onShutdownRequest(reason);}catch{}});
        return;
      }
      if(p==='/api/gateway/register'&&req.method==='POST'){
        if(req.headers.origin)return send({error:'注册仅允许本机启动桥'},403);
        if(!equal(String(req.headers.authorization??'').replace(/^Bearer /,''),access.token))return send({error:'共享服务管理凭据无效'},403);
        if(!String(req.headers['content-type']).startsWith('application/json'))return send({error:'仅接受JSON'},415);
        let size=0,parts=[];for await(const c of req){size+=c.length;if(size>16384)return send({error:'请求过大'},413);parts.push(c);}
        let body;try{body=JSON.parse(Buffer.concat(parts));}catch{return send({error:'JSON无效'},400);}
        return send(await register(body.projectRoot));
      }
      const match=p.match(/^\/projects\/([a-f0-9-]{36})(\/api\/.*)$/i);
      if(!match)return send({error:'请使用项目专属连接地址'},404);
      const id=match[1],entry=registry[id];if(!entry)return send({error:'项目未注册'},404);
      const project=loaded.get(id)??await activate(entry.root);
      if(project.id!==id)return send({error:'项目身份发生变化，拒绝自动重绑定'},409);
      const suffix=req.url.slice(('/projects/'+id).length);
      if(project.legacy){
        // Recheck identity before forwarding any credential. Never follow redirects.
        const h=await fetch(project.legacy+'/api/health',{redirect:'error',signal:AbortSignal.timeout(1500)});
        const identity=await h.json();
        if(!h.ok||identity.service!=='a4note-project-tasks'||identity.projectId!==id)return send({error:'旧服务身份变化，请重新连接'},409);
        const target=new URL(project.legacy);
        const upstream=http.request({hostname:'127.0.0.1',port:target.port,path:suffix,method:req.method,headers:{...req.headers,host:target.host}},r=>{
          // Cross-origin browser clients are restricted by the per-project service.
          res.writeHead(r.statusCode,r.headers);r.pipe(res);
        });
        upstream.on('error',()=>{if(!res.headersSent)send({error:'旧服务离线，需用户确认升级/重连'},503);else res.destroy();});
        res.on('close',()=>upstream.destroy());req.pipe(upstream);return;
      }
      req.url=suffix;project.app.server.emit('request',req,res);
    }catch(e){if(!res.headersSent)send({error:e.status?e.message:'共享服务无法处理请求，请检查本机日志'},e.status??500);else res.destroy();}
  });
  return {server,access,register,async listen(port=4319){
    await new Promise((resolve,reject)=>{
      const onError=e=>{if(e.code==='EADDRINUSE'&&port!==0){port=0;server.listen(0,'127.0.0.1');}else reject(e);};
      server.on('error',onError);server.once('listening',()=>{server.off('error',onError);resolve();});server.listen(port,'127.0.0.1');
    });base='http://127.0.0.1:'+server.address().port;return base;
  },async close(){for(const p of loaded.values())if(p.app)await p.app.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const stateDir=process.env.TASKS_GATEWAY_DIR;
  if(!stateDir)throw Error('必须由本机启动桥提供共享服务目录');
  const connectionPath=path.join(stateDir,'gateway-connection.json');
  let stopping=false;
  const stop=()=>{
    if(stopping)return;stopping=true;
    // A hung close must not leave a half-stopped listener behind; SQLite close still runs first in the normal path.
    const watchdog=setTimeout(()=>process.exit(0),5000);watchdog.unref();
    app.close().catch(()=>{}).finally(()=>{
      let current=null;try{current=read(connectionPath);}catch{}
      if(current?.pid===process.pid){try{fs.unlinkSync(connectionPath);}catch{}}
      process.exit(0);
    });
  };
  const app=createTaskGateway({stateDir,projectsHome:process.env.TASKS_PROJECTS_HOME,onShutdownRequest:stop});
  const url=await app.listen(Number(process.env.TASKS_PORT??4319));
  write(connectionPath,{url,pid:process.pid,id:app.access.id,startedAt:new Date().toISOString()});
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}

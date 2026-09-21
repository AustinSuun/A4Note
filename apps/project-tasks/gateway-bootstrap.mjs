import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const validUrl=value=>typeof value==='string'&&/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(value)&&Number(value.split(':').at(-1))>=1024&&Number(value.split(':').at(-1))<=65535;
export const GATEWAY_PROTOCOL=4;
/** Stop only our own outdated helper gateway (same access id, older protocol).
 * Older builds cannot adopt repaired data directories, so keeping them alive
 * would silently strand a project on an empty directory. Legacy per-project
 * services are never touched here. */
async function retireStaleGateway(stateDir){
  const c=read(path.join(stateDir,'gateway-connection.json')),a=read(path.join(stateDir,'gateway-access.json'));
  if(!c||!a||!validUrl(c.url)||c.id!==a.id||!Number.isSafeInteger(c.pid)||c.pid<=0)return;
  let health=null;
  try{const r=await fetch(c.url+'/api/gateway-health',{redirect:'error',signal:AbortSignal.timeout(1000)});health=r.ok?await r.json():null;}catch{}
  if(!health||health.service!=='a4note-task-gateway'||health.id!==a.id||health.version===GATEWAY_PROTOCOL)return;
  try{process.kill(c.pid,'SIGTERM');}catch{return;}
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){
    let alive=true;try{process.kill(c.pid,0);}catch{alive=false;}
    if(!alive)return;
    await wait(100);
  }
  try{process.kill(c.pid,'SIGKILL');}catch{}
}
export async function ensureGatewayProject({projectRoot,port=4319,stateDir=path.join(os.homedir(),'.a4note-project-tasks','gateway-v1'),timeoutMs=18000,projectsHome}={}){
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<13))throw Error('需要Node.js 22.13以上');
  if(!projectRoot||!path.isAbsolute(projectRoot)||!fs.statSync(projectRoot).isDirectory())throw Error('请选择有效项目文件夹');
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('端口无效');
  fs.mkdirSync(stateDir,{recursive:true,mode:0o700});
  const root=path.resolve(projectRoot),deadline=Date.now()+timeoutMs;
  const probe=async()=>{
    const c=read(path.join(stateDir,'gateway-connection.json')),a=read(path.join(stateDir,'gateway-access.json'));
    if(!c||!a||!validUrl(c.url)||c.id!==a.id)return null;
    try{
      const r=await fetch(c.url+'/api/gateway-health',{redirect:'error',signal:AbortSignal.timeout(1000)});
      const h=await r.json();if(r.ok&&h.service==='a4note-task-gateway'&&h.version===GATEWAY_PROTOCOL&&h.id===a.id)return {url:c.url,token:a.token};
    }catch{}
    return null;
  };
  const register=async hub=>{
    const r=await fetch(hub.url+'/api/gateway/register',{method:'POST',redirect:'error',signal:AbortSignal.timeout(6000),headers:{Authorization:'Bearer '+hub.token,'Content-Type':'application/json'},body:JSON.stringify({projectRoot:root})});
    const body=await r.json();if(!r.ok)throw Error(body.error??'共享项目注册失败');return body;
  };
  let hub=await probe();if(hub)return register(hub);
  await retireStaleGateway(stateDir);hub=await probe();if(hub)return register(hub);
  const lockPath=path.join(stateDir,'gateway-bootstrap.lock');let lock;
  while(lock===undefined){
    try{lock=fs.openSync(lockPath,'wx',0o600);fs.writeFileSync(lock,JSON.stringify({pid:process.pid}));}
    catch(e){if(e.code!=='EEXIST')throw e;hub=await probe();if(hub)return register(hub);if(Date.now()>deadline)throw Error('另一共享服务启动请求尚未结束；未抢占启动锁');await wait(100);}
  }
  let child,ready=false;
  try{
    hub=await probe();if(hub)return await register(hub);
    // Only our explicit configuration reaches the child; inherited per-project config must not leak.
    const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('TASKS_'))delete env[key];
    Object.assign(env,{TASKS_GATEWAY_DIR:stateDir,TASKS_PORT:String(port)});
    if(projectsHome)env.TASKS_PROJECTS_HOME=path.resolve(projectsHome);
    const log=fs.openSync(path.join(stateDir,'startup.log'),'a',0o600);
    try{child=spawn(process.execPath,[path.join(here,'gateway.mjs')],{env,cwd:here,detached:true,windowsHide:true,stdio:['ignore',log,log]});}finally{fs.closeSync(log);}
    let error;child.on('error',e=>{error=e;});
    while(Date.now()<deadline){
      if(error||child.exitCode!==null)throw Error('共享服务启动失败，请检查私有startup.log');
      hub=await probe();if(hub){ready=true;child.unref();return await register(hub);}await wait(100);
    }
    throw Error('共享服务启动超时，未停止其他程序');
  }finally{if(child&&!ready&&child.exitCode===null)child.kill();fs.closeSync(lock);fs.unlinkSync(lockPath);}
}

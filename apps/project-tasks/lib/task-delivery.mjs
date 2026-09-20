// Immutable, explicitly scoped code delivery. Never infer it from a dirty shared HEAD.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
const sha=/^[0-9a-f]{40,64}$/i;
function git(root,args){return execFileSync('git',['-c','core.hooksPath=',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:4*1024*1024}).trim();}
function ancestor(root,a,b){try{git(root,['merge-base','--is-ancestor',a,b]);return true;}catch(e){if(e.status===1)return false;throw e;}}
function repo(root){if(!root)throw Error('服务尚未绑定项目仓库');return fs.realpathSync(git(root,['rev-parse','--show-toplevel']));}
const errorText=e=>String(e.stderr||e.message||e).slice(0,4000);
function latest(store,id,kind){const row=store.db.prepare('SELECT payload FROM events WHERE task_id=? AND kind=? ORDER BY seq DESC LIMIT 1').get(id,kind);return row?JSON.parse(row.payload):null;}
export function taskDelivery(store,t){const d=latest(store,t.id,'task.delivery');return d?.deliveryRevision===t.delivery_revision?d:null;}
export function taskIntegration(store,t){const x=latest(store,t.id,'task.integration');return x?.deliveryRevision===t.delivery_revision?x:null;}
export function captureTaskDelivery(store,t,input){
 const version={deliveryRevision:t.delivery_revision+1,specRevision:t.spec_revision};
 if(input===undefined)return {...version,kind:'unknown',reason:'旧交付未声明代码范围，不推断已合并'};
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('delivery对象无效');
 if(input.kind==='none'){
  if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)throw Error('非代码交付须说明原因');
  return {...version,kind:'none',reason:input.reason};
 }
 if(input.kind!=='code'||!sha.test(input.commit)||!sha.test(input.baseCommit))throw Error('代码交付须绑定完整commit和baseCommit');
 if(typeof input.sourceRef!=='string'||!input.sourceRef.startsWith('refs/heads/')||input.sourceRef.length>256||/[\r\n\0]/.test(input.sourceRef))throw Error('sourceRef须为完整本地分支引用');
 if(typeof input.validation!=='string'||!input.validation.trim()||input.validation.length>8000)throw Error('须提供已执行的验证与证据说明');
 const root=repo(store.projectRoot);
 if(git(root,['rev-parse','--verify',input.sourceRef+'^{commit}'])!==input.commit)throw Error('分支与交付提交不一致');
 if(!ancestor(root,input.baseCommit,input.commit))throw Error('基线不是交付祖先');
 const paths=git(root,['diff','--name-only',input.baseCommit,input.commit]).split('\n').filter(Boolean).sort();
 if(!Array.isArray(input.paths)||!input.paths.length||input.paths.some(p=>typeof p!=='string')||JSON.stringify([...new Set(input.paths)].sort())!==JSON.stringify(paths))throw Error('变更清单与提交差异不一致，禁止混入其他任务');
 return {...version,kind:'code',repository:root,commit:input.commit,baseCommit:input.baseCommit,sourceRef:input.sourceRef,paths,validation:input.validation,target:'main',submittedAt:new Date().toISOString()};
}
// Git CAS and its index lock provide final protection against external Git writers.
// A per-common-repository lock serializes this service across projects/worktrees.
function lockRepo(root){
 const common=git(root,['rev-parse','--path-format=absolute','--git-common-dir']);
 const file=path.join(common,'a4note-task-integration.lock');
 try{const fd=fs.openSync(file,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));fs.closeSync(fd);}
 catch(e){if(e.code==='EEXIST')throw Error('仓库合并锁被占用；如服务崩溃，请用户核实旧进程停止后移除锁再重试');throw e;}
 return ()=>fs.unlinkSync(file);
}
function mergeCode(store,d){
 const root=repo(store.projectRoot);
 if(root!==d.repository)throw Error('项目仓库身份变化，拒绝合并');
 if(!Array.isArray(store.gitVerifyArgv)||!store.gitVerifyArgv.length||store.gitVerifyArgv.some(v=>typeof v!=='string'||!v))throw Error('未配置可信合并验证命令 TASKS_GIT_VERIFY_ARGV；不会跳过验证');
 const unlock=lockRepo(root);let temp,added=false;
 try{
  const target='refs/heads/main',before=git(root,['rev-parse','--verify',target+'^{commit}']);
  if(ancestor(root,d.commit,before))return {status:'already_on_target',before,after:before,target:'main',sourceCommit:d.commit,remote:'not_pushed'};
  if(!ancestor(root,d.baseCommit,before))throw Error('交付基线不属于当前main；需重新整理分支并验收');
  // Reject dirty checked-out target BEFORE integration, not after writing refs.
  const worktrees=git(root,['worktree','list','--porcelain']).split('\n\n').map(block=>Object.fromEntries(block.split('\n').filter(Boolean).map(line=>{const at=line.indexOf(' ');return at<0?[line,true]:[line.slice(0,at),line.slice(at+1)];})));
  const checkout=worktrees.find(w=>w.branch===target);
  if(checkout&&git(checkout.worktree,['status','--porcelain','--untracked-files=all']))throw Error('main工作区存在未提交修改；不覆盖、不stash，等待用户处理');
  temp=fs.mkdtempSync(path.join(os.tmpdir(),'a4-task-integration-'));fs.rmdirSync(temp);
  git(root,['worktree','add','--detach',temp,before]);added=true;
  try{git(temp,['-c','user.name=A4 Note Integration','-c','user.email=taskboard@localhost','merge','--no-ff','--no-edit',d.commit]);}
  catch(e){let conflicts='';try{conflicts=git(temp,['diff','--name-only','--diff-filter=U']);}catch{}throw Error('合并冲突/失败：'+conflicts+' '+errorText(e));}
  const candidate=git(temp,['rev-parse','HEAD']);git(temp,['diff','--check',before,candidate]);
  // Only operator/service configuration may choose this command. Task payload cannot.
  const [exe,...args]=store.gitVerifyArgv;
  const output=execFileSync(exe,args,{cwd:temp,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:600000,maxBuffer:8*1024*1024});
  if(git(temp,['diff','--name-only'])||git(temp,['diff','--cached','--name-only']))throw Error('验证修改了受跟踪源码，拒绝合并未验证内容');
  if(git(root,['rev-parse',target])!==before)throw Error('main在验证期间变化；重试将重新合并和验证');
  if(checkout){
   if(git(checkout.worktree,['symbolic-ref','HEAD'])!==target||git(checkout.worktree,['status','--porcelain','--untracked-files=all']))throw Error('main工作区在验证期间发生变化，拒绝写入');
   git(checkout.worktree,['merge','--ff-only',candidate]);
  }else git(root,['update-ref',target,candidate,before]);
  const after=git(root,['rev-parse',target]);
  if(!ancestor(root,d.commit,after))throw Error('合并后包含关系验证失败');
  return {status:'merged',before,after,target:'main',sourceCommit:d.commit,verification:output.slice(-4000),remote:'not_pushed'};
 }finally{
  if(added){try{git(root,['worktree','remove','--force',temp]);}catch{}}
  unlock();
 }
}
/** Called INSIDE the task transaction, from both manual and automatic acceptance.
 * If Git commits but SQLite fails, retry checks ancestry and reconciles the result.
 * No historical tasks are scanned or merged at startup. */
export function integrateAcceptedTask(store,t,actor){
 const d=taskDelivery(store,t);
 let result;
 if(!d||d.kind==='unknown')result=store.projectRoot?{status:'blocked',error:'缺少明确交付信息，请退回补齐；不得把归档等同合并'}:{status:'not_configured',error:'旧服务未绑定仓库，未执行合并'};
 else if(d.kind==='none')result={status:'not_applicable',reason:d.reason};
 else if(d.specRevision!==t.spec_revision)result={status:'blocked',error:'验收与交付要求版本不一致'};
 else {try{result=mergeCode(store,d);}catch(e){result={status:'failed',error:errorText(e)};}}
 const payload={...result,deliveryRevision:t.delivery_revision,specRevision:t.spec_revision,acceptedBy:actor,acceptedAt:new Date().toISOString()};
 store.event(t.id,actor,'task.integration',payload);
 const ok=['merged','already_on_target','not_applicable','not_configured'].includes(result.status);
 if(!ok)store.db.prepare("UPDATE tasks SET progress='验收通过，但代码集成阻塞；查看合并状态并重试' WHERE id=?").run(t.id);
 return ok;
}

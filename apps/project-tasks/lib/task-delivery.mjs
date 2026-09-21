// Immutable, explicitly scoped code delivery. Never infer it from a dirty shared HEAD.
import fs from 'node:fs';
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
 if(!ancestor(root,input.commit,git(root,['rev-parse','--verify','refs/heads/main^{commit}'])))throw Error('请执行Agent先验证并合并到本地main，再提交待检查');
 return {...version,kind:'code',repository:root,commit:input.commit,baseCommit:input.baseCommit,sourceRef:input.sourceRef,paths,validation:input.validation,target:'main',submittedAt:new Date().toISOString()};
}
/** Read-only reconciliation. Acceptance NEVER merges, checks out, updates refs,
 * runs verification commands, or changes a user worktree. Agents own integration. */
export function integrateAcceptedTask(store,t,actor){
 const d=taskDelivery(store,t);let result;
 if(!d||d.kind==='unknown')result={status:'not_configured',error:'旧交付未声明合并记录；归档仅确认验收，不表示代码已合并'};
 else if(d.kind==='none')result={status:'not_applicable',reason:d.reason};
 else {
  try {
   const root=repo(store.projectRoot);
   if(root!==d.repository)throw Error('项目仓库身份变化，无法核对合并记录');
   const target=git(root,['rev-parse','--verify','refs/heads/main^{commit}']);
   result=ancestor(root,d.commit,target)
    ? {status:'already_on_target',before:target,after:target,target:'main',sourceCommit:d.commit,remote:'not_pushed'}
    : {status:'blocked',error:'交付尚未包含在main；请执行Agent完成验证和合并，归档不会代为合并'};
  }catch(e){result={status:'failed',error:errorText(e)};}
 }
 store.event(t.id,actor,'task.integration',{...result,deliveryRevision:t.delivery_revision,specRevision:t.spec_revision,acceptedBy:actor,acceptedAt:new Date().toISOString(),mode:'agent_owned'});
 // Legacy/unavailable Git metadata must not turn acceptance into a Git operation.
 return true;
}

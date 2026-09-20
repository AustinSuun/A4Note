import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {defaultAcceptance, configureAcceptance, requestAcceptance, claimAcceptance, cancelAcceptance, completeAcceptance, AcceptancePolicyError} from './acceptance-policy.mjs';
const fail=(status,message)=>{throw new AcceptancePolicyError(status,message);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const parse=row=>row ? JSON.parse(row.value) : null;
export function migrateAcceptance(store) {
  const db=store.db;
  if(db.prepare('PRAGMA table_info(tasks)').all().some(c=>c.name==='delivery_revision'))return;
  // Snapshot before additive changes; never open the live legacy process's database.
  if(db.prepare('SELECT count(*) AS n FROM tasks').get().n) {
    const file=path.join(store.dir,`before-acceptance-${Date.now()}-${process.pid}.sqlite`);
    db.prepare('VACUUM INTO ?').run(file);
  }
  store.transaction(()=>{
    db.exec(`ALTER TABLE tasks ADD COLUMN delivery_revision INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN acceptance_archive_run TEXT;
      UPDATE tasks SET delivery_revision=1 WHERE status IN ('review','archived') AND result<>'';
      CREATE TABLE task_acceptance(task_id TEXT PRIMARY KEY REFERENCES tasks(id),value TEXT NOT NULL);
      CREATE TABLE acceptance_runs(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),value TEXT NOT NULL);
      CREATE TABLE acceptance_evidence(attachment_id TEXT PRIMARY KEY REFERENCES attachments(id),value TEXT NOT NULL);`);
  });
}
export function acceptanceState(store,id) {
  store.get(id);
  return {config:parse(store.db.prepare('SELECT value FROM task_acceptance WHERE task_id=?').get(id))??defaultAcceptance(),
    runs:store.db.prepare('SELECT value FROM acceptance_runs WHERE task_id=? ORDER BY rowid DESC').all(id).map(parse)};
}
function getRun(store,id,runId) {
  const row=store.db.prepare('SELECT value FROM acceptance_runs WHERE id=? AND task_id=?').get(runId,id);
  if(!row)fail(404,'验收请求不存在');return parse(row);
}
const context=(store,task,config,run)=>({task,config,projectId:store.access.projectId,target:run.binding.target});
const saveRun=(store,id,run)=>store.db.prepare('INSERT INTO acceptance_runs(id,task_id,value) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(run.id,id,JSON.stringify(run));
function evidenceIndex(store,id) {
  return store.db.prepare('SELECT a.*,e.value FROM attachments a JOIN acceptance_evidence e ON e.attachment_id=a.id WHERE a.task_id=?').all(id).map(a=>{
    let bytesSha256='';try{bytesSha256=hash(fs.readFileSync(path.join(store.dir,'attachments',a.id)));}catch{}
    return {...a,...JSON.parse(a.value),bytesSha256};
  });
}
export function acceptanceAction(store,actor,id,input) {
 return store.transaction(()=>{
  const task=store.get(id),state=acceptanceState(store,id),action=input.action;
  if(!['configure','request','claim','cancel','complete','reopen'].includes(action))fail(400,'未知验收操作');
  const run=input.runId?getRun(store,id,input.runId):null;
  const replay=action==='complete'&&run?.status==='completed';
  // Run-scoped actions are guarded by runRevision plus the delivery/criteria binding, not the mutable task revision.
  if(['configure','request'].includes(action) && (!Number.isInteger(input.revision)||task.revision!==input.revision))fail(409,'任务已更新，请重新读取');
  if(task.status==='archived'&&action!=='reopen'&&!replay)fail(409,'已归档任务只读');
  let result;
  if(action==='configure') {
    const config=configureAcceptance(actor,state.config,{...input,revision:input.configRevision},task);
    store.db.prepare('INSERT INTO task_acceptance(task_id,value) VALUES(?,?) ON CONFLICT(task_id) DO UPDATE SET value=excluded.value').run(id,JSON.stringify(config));
  } else if(action==='request') {
    if(state.runs.some(r=>['waiting','running'].includes(r.status)&&r.expiresAt>Date.now()))fail(409,'已有验收请求；请先取消旧请求');
    result=requestAcceptance(actor,{task,config:state.config,projectId:store.access.projectId,target:input.target},input.ttlMs);
    saveRun(store,id,result);
  } else if(action==='reopen') {
    if(actor.role!=='human'||actor.id!=='human'||task.status!=='archived'||!task.acceptance_archive_run)fail(403,'仅用户可复核并退回自动归档任务');
    const reason=typeof input.reason==='string'?input.reason.trim():'';
    if(!reason||reason.length>8000)fail(400,'请填写复核返工原因');
    store.db.prepare("UPDATE tasks SET status='review',feedback=?,progress='自动验收后人工复核',acceptance_archive_run=NULL WHERE id=?").run(reason,id);
  } else {
    if(!run)fail(400,'需要验收请求ID');
    if(action==='claim')result=claimAcceptance(actor,run,context(store,task,state.config,run),input.runRevision,input.capabilities);
    if(action==='cancel')result=cancelAcceptance(actor,run,input.runRevision);
    if(action==='complete') {
      // Completed automatic archive retries may evaluate the same reviewed delivery, never a changed one.
      const replayTask=replay&&task.status==='archived'&&task.acceptance_archive_run===run.id?{...task,status:'review'}:task;
      const evidence=evidenceIndex(store,id);
      const report=input.report;
      const attached=evidence.find(e=>e.id===report?.reportAttachmentId&&e.evidence_kind==='report');
      if(!attached)fail(400,'先上传绑定本次验收的JSON报告');
      let fileReport;try{fileReport=JSON.parse(fs.readFileSync(path.join(store.dir,'attachments',attached.id),'utf8'));}catch{fail(400,'报告附件不是有效JSON');}
      const withoutId=value=>{const {reportAttachmentId,...rest}=value;return rest;};
      if(JSON.stringify(withoutId(fileReport))!==JSON.stringify(withoutId(report)))fail(409,'提交报告与实际报告附件不一致');
      const out=completeAcceptance(actor,run,context(store,replayTask,state.config,run),input.runRevision,report,evidence);
      if(out.replay)return {task:store.detail(id),...state,replay:true};
      result={...out.run,report};
      if(out.decision==='eligible_for_auto_archive')store.db.prepare("UPDATE tasks SET status='archived',acceptance_archive_run=?,progress='自动验收通过（用户可复核返工）' WHERE id=?").run(run.id,id);
    }
    saveRun(store,id,result);
  }
  store.db.prepare('UPDATE tasks SET revision=revision+1,updated_at=? WHERE id=?').run(new Date().toISOString(),id);
  store.event(id,actor.id,'acceptance.'+action,{runId:result?.id??null,decision:result?.outcome?.decision??null,configRevision:acceptanceState(store,id).config.revision});
  store.heartbeat(actor);
  return {task:store.detail(id),...acceptanceState(store,id)};
 });
}
export function bindAcceptanceEvidence(store,actor,task,input,attachmentId) {
  if(!input.acceptanceRunId)return false;
  const run=getRun(store,task.id,input.acceptanceRunId), config=acceptanceState(store,task.id).config;
  if(actor.role!=='worker'||run.runnerId!==actor.id||actor.id===task.owner)fail(403,'仅已领取本请求的独立验收者可上传证据');
  if(task.status!=='review'||run.status!=='running'||Date.now()>=run.expiresAt)fail(409,'验收已结束或过期');
  const b=run.binding;
  if(task.spec_revision!==b.specRevision||task.delivery_revision!==b.deliveryRevision||hash(task.result)!==b.resultHash||config.revision!==b.criteriaRevision)fail(409,'当前交付或标准已变化');
  if(input.purpose!=='result'||!['report','screenshot'].includes(input.evidenceKind))fail(400,'验收证据必须是报告或截图结果附件');
  if(input.evidenceKind==='screenshot'&&!run.criteria.some(c=>c.id===input.criterionId))fail(400,'截图须绑定本次标准');
  if(!Number.isSafeInteger(input.capturedAt)||input.capturedAt<run.claimedAt||input.capturedAt>Date.now())fail(400,'捕获时间不属于本次运行');
  const meta={project_id:b.projectId,acceptance_run_id:run.id,delivery_revision:b.deliveryRevision,criteria_revision:b.criteriaRevision,
    build_sha256:b.target.sha256,captured_at:input.capturedAt,evidence_kind:input.evidenceKind,criterion_id:input.criterionId??null};
  // Called once before insert for authorization and once after insert for atomic metadata binding.
  if(attachmentId)store.db.prepare('INSERT INTO acceptance_evidence(attachment_id,value) VALUES(?,?)').run(attachmentId,JSON.stringify(meta));
  return true;
}

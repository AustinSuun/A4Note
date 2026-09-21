import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { defaultAcceptance, configureAcceptance, requestAcceptance, claimAcceptance,
  cancelAcceptance, completeAcceptance } from '../lib/acceptance-policy.mjs';
const human = {id:'human',role:'human'}, developer = {id:'developer',role:'worker'}, runner = {id:'runner',role:'worker'};
const start=1800000000000;
const hash=s=>createHash('sha256').update(s).digest('hex');
const target={kind:'desktop',source:'fixture-only/A4Note.exe',version:'isolated-fixture-v1',sha256:hash('fixture build')};
const criteria=[{id:'save',label:'保存后可读取',expected:'重启后内容相同',capability:'desktop',objective:true,screenshotRequired:true}];
const error=(status,fn)=>assert.throws(fn,e=>e.status===status);
function fixture(mode='automatic') {
  const task={id:'task-1',status:'review',owner:developer.id,spec_revision:3,claimed_spec:3,delivery_revision:2,result:'夹具交付，不代表真实UI验收'};
  const config=configureAcceptance(human,defaultAcceptance(),{revision:0,mode,criteria},task,start);
  const context={task,config,projectId:'project-1',target};
  const waiting=requestAcceptance(human,context,60000,start);
  const run=claimAcceptance(runner,waiting,context,1,['desktop'],start+1);
  const base={task_id:task.id,project_id:context.projectId,acceptance_run_id:run.id,created_by:runner.id,
    purpose:'result',retired_at:null,delivery_revision:2,criteria_revision:1,build_sha256:target.sha256,captured_at:start+2};
  const attachments=[{...base,id:'report-1',evidence_kind:'report',mime:'text/markdown',sha256:hash('fixture report'),bytesSha256:hash('fixture report')},
    {...base,id:'image-1',criterion_id:'save',evidence_kind:'screenshot',mime:'image/png',sha256:hash('fixture image'),bytesSha256:hash('fixture image')}];
  const report={runId:run.id,projectId:context.projectId,taskId:task.id,deliveryRevision:2,criteriaRevision:1,target,
    environment:'协议夹具；未执行真实桌面/未捕获截图',reportAttachmentId:'report-1',
    checks:[{id:'save',status:'passed',capability:'desktop',steps:'夹具步骤',expected:criteria[0].expected,actual:'夹具结果',screenshotAttachmentId:'image-1'}]};
  return {context,waiting,run,attachments,report};
}
const complete=f=>completeAcceptance(runner,f.run,f.context,f.run.revision,f.report,f.attachments,start+3);

test('legacy/default configuration stays manual without approval',()=>{
  assert.deepEqual(defaultAcceptance(),{mode:'manual',revision:0,specRevision:null,approvedBy:null,criteria:[],approvedAt:null});
  const f=fixture();f.context.config=defaultAcceptance();error(409,()=>requestAcceptance(human,f.context,60000,start));
});
test('only human may approve criteria, request or cancel; workers and dispatchers cannot elevate',()=>{
  const f=fixture();
  for(const actor of [developer,runner,{id:'dispatcher',role:'dispatcher'},{id:'fake',role:'human'}]) {
    error(403,()=>configureAcceptance(actor,defaultAcceptance(),{revision:0,mode:'automatic',criteria},f.context.task,start));
    error(403,()=>requestAcceptance(actor,f.context,60000,start));
    error(403,()=>cancelAcceptance(actor,f.run,2,start+2));
  }
});
test('criteria reject stale revision, duplicates, missing booleans, subjective automatic and empty automatic',()=>{
  const f=fixture();
  error(409,()=>configureAcceptance(human,f.context.config,{revision:0,mode:'manual',criteria},f.context.task,start));
  for(const entries of [[],[...criteria,...criteria],[{...criteria[0],objective:false}],[{...criteria[0],screenshotRequired:undefined}],[{...criteria[0],id:'../bad'}]])
    error(400,()=>configureAcceptance(human,defaultAcceptance(),{revision:0,mode:'automatic',criteria:entries},f.context.task,start));
});
test('manual subjective standard remains advisory and cannot auto-archive',()=>{
  const f=fixture('manual');
  assert.equal(complete(f).decision,'advisory_pass');assert.equal(f.context.task.status,'review');
  f.context.config=configureAcceptance(human,f.context.config,{revision:1,mode:'manual',criteria:[{...criteria[0],objective:false}]},f.context.task,start);
  const waiting=requestAcceptance(human,f.context,60000,start);
  f.run=claimAcceptance(runner,waiting,f.context,1,['desktop'],start+1);
  f.report.runId=f.run.id;f.report.criteriaRevision=2;
  f.attachments=f.attachments.map(a=>({...a,acceptance_run_id:f.run.id,criteria_revision:2}));
  assert.equal(complete(f).decision,'needs_human_review');
});
test('request requires current reviewed delivery and approved versions',()=>{
  for(const change of [{status:'in_progress'},{delivery_revision:0},{claimed_spec:2},{owner:null},{result:''}]) {
    const f=fixture();Object.assign(f.context.task,change);assert.throws(()=>requestAcceptance(human,f.context,60000,start));
  }
  const f=fixture();f.context.config.specRevision=2;error(409,()=>requestAcceptance(human,f.context,60000,start));
});
test('legacy plan metadata does not gate direct queue acceptance',()=>{
  const f=fixture();Object.assign(f.context.task,{plan_revision:1,claimed_plan_revision:0});
  const run=requestAcceptance(human,f.context,60000,start);
  assert.equal(run.binding.planRevision,undefined);
});
test('developer session cannot self-claim; human/dispatcher cannot impersonate a worker',()=>{
  const f=fixture();for(const actor of [developer,human,{id:'dispatch',role:'dispatcher'}])
    error(403,()=>claimAcceptance(actor,f.waiting,f.context,1,['desktop'],start+1));
});
test('only declared required capability qualifies, no browser-for-desktop substitution',()=>{
  const f=fixture();for(const caps of [[],['browser'],['command','browser']])
    error(409,()=>claimAcceptance(runner,f.waiting,f.context,1,caps,start+1));
  error(400,()=>claimAcceptance(runner,f.waiting,f.context,1,['anything'],start+1));
});
test('compare-and-swap policy rejects stale claim and second claimant on persisted state',()=>{
  const f=fixture();error(409,()=>claimAcceptance(runner,f.waiting,f.context,0,['desktop'],start+1));
  error(409,()=>claimAcceptance({id:'other',role:'worker'},f.run,f.context,1,['desktop'],start+2));
  error(409,()=>claimAcceptance({id:'other',role:'worker'},f.run,f.context,2,['desktop'],start+2));
  // Actual concurrent transaction arbitration belongs to the future Store adapter.
});
test('claim and report deny expired runs, backward clock, and bad TTL',()=>{
  const f=fixture();
  error(409,()=>claimAcceptance(runner,f.waiting,f.context,1,['desktop'],start+60000));
  error(409,()=>claimAcceptance(runner,f.waiting,f.context,1,['desktop'],start-1));
  error(409,()=>completeAcceptance(runner,f.run,f.context,2,f.report,f.attachments,start+60000));
  for(const ttl of [0,-1,86400001,NaN])error(400,()=>requestAcceptance(human,f.context,ttl,start));
});
test('cancelled request cannot claim or report and does not terminate any external process',()=>{
  const f=fixture();const c=cancelAcceptance(human,f.run,2,start+2);assert.equal(c.status,'cancelled');
  error(409,()=>completeAcceptance(runner,c,f.context,3,f.report,f.attachments,start+3));
  error(409,()=>claimAcceptance(runner,c,f.context,3,['desktop'],start+3));
});
test('automatic policy permits only complete matching evidence; does not mutate task or archive itself',()=>{
  const f=fixture(),before=structuredClone(f);const r=complete(f);
  assert.equal(r.decision,'eligible_for_auto_archive');assert.deepEqual(r.run.outcome.reasons,[]);
  assert.equal(r.run.status,'completed');assert.equal(r.run.revision,3);assert.equal(r.replay,false);
  assert.deepEqual(f,before);assert.equal(f.context.task.status,'review');
});
test('report must come from assigned independent runner, not developer/another worker/dispatcher',()=>{
  const f=fixture();for(const actor of [developer,{id:'other',role:'worker'},{id:'dispatcher',role:'dispatcher'}])
    error(403,()=>completeAcceptance(actor,f.run,f.context,2,f.report,f.attachments,start+3));
});
test('cross-project, task and run submission rejected',()=>{
  for(const field of ['runId','taskId','projectId']) {const f=fixture();f.report[field]='other';error(403,()=>complete(f));}
});
test('stale delivery, criteria, spec, result, mode and target invalidate pending evidence',()=>{
  const changes=[f=>f.context.task.delivery_revision++,f=>f.context.config.revision++,f=>f.context.task.spec_revision++,
    f=>f.context.task.result+=' changed',f=>f.context.config.mode='manual',
    f=>f.context.config.criteria[0].expected='changed',f=>f.context.target={...target,sha256:hash('new build')}];
  for(const change of changes){const f=fixture();change(f);error(409,()=>complete(f));}
});
test('report-side stale revisions and build/source/version spoofing rejected',()=>{
  for(const change of [f=>f.report.deliveryRevision++,f=>f.report.criteriaRevision++,
    f=>f.report.target={...target,sha256:hash('other')},f=>f.report.target={...target,source:'other.exe'},
    f=>f.report.target={...target,version:'v-other'}]) {const f=fixture();change(f);error(409,()=>complete(f));}
});
test('missing report attachment or screenshot prevents automatic pass',()=>{
  for(const id of ['report-1','image-1']) {const f=fixture();f.attachments=f.attachments.filter(a=>a.id!==id);assert.equal(complete(f).decision,'needs_human_review');}
});
test('server indexed evidence must bind task/project/run/creator/versions/build/purpose/bytes and freshness',async t=>{
  for(const change of [{task_id:'other'},{project_id:'other'},{acceptance_run_id:'old'}, {created_by:developer.id},
    {delivery_revision:1},{criteria_revision:0},{build_sha256:hash('old')},{purpose:'reference'},
    {retired_at:start+2},{bytesSha256:hash('modified bytes')},{captured_at:start},{captured_at:start+4},
    {captured_at:'2026-09-19'}, {evidence_kind:'reference'}, {criterion_id:'other'}, {mime:'image/svg+xml'}])
    await t.test(JSON.stringify(change),()=>{const f=fixture();Object.assign(f.attachments[1],change);assert.equal(complete(f).decision,'needs_human_review');});
});
test('failed, not-run, blocked, missing and subjective checks never automatically pass',()=>{
  for(const status of ['failed','not_run','blocked']) {const f=fixture();f.report.checks[0].status=status;assert.equal(complete(f).decision,'needs_human_review');}
  const f=fixture();f.report.checks=[];assert.equal(complete(f).decision,'needs_human_review');
});
test('wrong capability or approved expected-result drift cannot pass',()=>{
  for(const change of [{capability:'browser'},{expected:'weakened standard'}]) {const f=fixture();Object.assign(f.report.checks[0],change);assert.equal(complete(f).decision,'needs_human_review');}
});
test('duplicate/unknown checks and malformed or oversized reports rejected',()=>{
  for(const change of [f=>f.report.checks.push(f.report.checks[0]),f=>f.report.checks[0].id='unknown',
    f=>f.report.checks[0].status='success',f=>f.report.checks[0].actual='',f=>f.report.environment='',f=>f.report.padding='x'.repeat(64000)]) {
    const f=fixture();change(f);error(400,()=>complete(f));
  }
});
test('exact completion retry is idempotent; different callback or revision cannot rewrite saved outcome',()=>{
  const f=fixture();const done=complete(f);
  const retry=completeAcceptance(runner,done.run,f.context,2,f.report,f.attachments,start+70000);
  assert.equal(retry.replay,true);assert.deepEqual(retry.run,done.run);
  error(409,()=>completeAcceptance(runner,done.run,f.context,3,f.report,f.attachments,start+4));
  f.report.checks[0].actual='different';error(409,()=>completeAcceptance(runner,done.run,f.context,2,f.report,f.attachments,start+4));
});
test('changing current delivery invalidates even a retry, no stale successful decision reused',()=>{
  const f=fixture();const done=complete(f);f.context.task.delivery_revision++;
  error(409,()=>completeAcceptance(runner,done.run,f.context,2,f.report,f.attachments,start+4));
});
test('outputs own their mutable values, callers cannot mutate stored policy through aliasing',()=>{
  const f=fixture();const c=structuredClone(f.context.config);const r=requestAcceptance(human,f.context,60000,start);
  r.criteria[0].expected='mutated';r.binding.target.source='mutated';
  assert.deepEqual(f.context.config,c);assert.equal(f.context.target.source,target.source);
});

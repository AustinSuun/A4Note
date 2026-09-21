import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const root = path.resolve('src/features/taskboard');
const temp = path.resolve('.tmp/task-stage-tests', String(process.pid));
fs.mkdirSync(temp, { recursive: true });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
try {
  const files = ['taskStageModel.ts', 'TaskStageViews.tsx', 'taskStageSession.ts'];
  const program = ts.createProgram(files.map(f => path.join(root, f)), {
    strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, types: ['react', 'react-dom', 'vite/client'],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  check(!diagnostics.length, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: f => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
  }));
  for (const file of files) {
    let output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    output = output.replace(/import ['"][^'"]+\.css['"];?/g, '')
      .replace("from './taskStageModel'", "from './taskStageModel.mjs'");
    fs.writeFileSync(path.join(temp, file.replace(/\.tsx?$/, '.mjs')), output);
  }
  const model = await import(pathToFileURL(path.join(temp, 'taskStageModel.mjs')).href);
  const views = await import(pathToFileURL(path.join(temp, 'TaskStageViews.mjs')).href);
  const base = {id:'task', title:'标题 <script>bad</script>',description:'需求',acceptance:'验收标准',priority:'normal',owner:null,revision:1,spec_revision:2,claimed_spec:null,progress:'',result:'',feedback:'',updated_at:'2026-09-19T01:00:00Z',created_at:'2026-09-18T01:00:00Z'};
  const statuses = ['queued', 'in_progress', 'review', 'archived'];
  const tasks = statuses.map(status => ({...base, id: status, status}));
  const frozen = JSON.stringify(tasks);
  const counts = model.stageCounts(tasks);
  check(counts.all === 4, 'All count');
  for (const stage of statuses) {
    check(counts[stage] === 1, 'Stage count ' + stage);
    check(model.tasksForStage(tasks, stage, '')[0].id === stage, 'Stage isolation ' + stage);
    check(model.stageTaskFacts(tasks.find(t => t.status === stage)).length >= 2, 'Stage-specific facts ' + stage);
  }
  const legacy = {...base, id:'legacy-backlog', status:'backlog'};
  check(model.visibleTaskStage('backlog') === 'queued', 'Legacy backlog is read as queue');
  check(model.stageCounts([...tasks, legacy]).queued === 2, 'Legacy backlog joins queue count');
  check(model.tasksForStage(tasks, 'all', '不存在').length === 0, 'Search miss');
  check(model.tasksForStage([{...tasks[1],owner:'agent'}], 'in_progress', '青禾', [{id:'agent',alias:'青禾'}]).length === 1, 'Alias search');
  const ordered = model.tasksForStage([{...tasks[0],id:'low',priority:'low'}, {...tasks[0],id:'high',priority:'high'}], 'queued', '');
  check(ordered[0].id === 'high', 'Queue priority first');
  check(JSON.stringify(tasks) === frozen, 'No snapshot mutation');
  for(const value of [null,undefined,'unknown','__proto__',{},[]]) check(!model.isTaskStage(value), 'Reject invalid stage');
  const data = new Map();
  const storage = {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
  check(model.readTaskStage(storage,'A') === 'all', 'First use overview');
  check(model.writeTaskStage(storage,'A','review'), 'Save stage');
  check(model.readTaskStage(storage,'A') === 'review', 'Restore stage');
  check(model.readTaskStage(storage,'B') === 'all', 'Project isolation');
  check(!model.writeTaskStage(storage,'','review'), 'No global empty project preference');
  check(!model.writeTaskStage(storage,'A','invalid'), 'Reject invalid stored stage');
  const broken = {getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('denied')}};
  check(model.readTaskStage(broken,'A') === 'all', 'Denied storage fallback');
  check(!model.writeTaskStage(broken,'A','review'), 'Denied write fallback');
  const session = await import(pathToFileURL(path.join(temp, 'taskStageSession.mjs')).href);
  check(session.readStageSession(null, '').stage === 'all', 'Workspace empty identity fallback');
  const value = {stage:'review',views:{review:{query:'任务',selectedId:'task-review',top:42,left:18}}};
  check(session.saveStageSession(storage,'workspace-A',value), 'Workspace save');
  const restored = session.readStageSession(storage,'workspace-A');
  check(restored.stage === 'review' && restored.views.review.query === '任务', 'Workspace phase query restoration');
  check(restored.views.review.selectedId === 'task-review' && restored.views.review.top === 42, 'Workspace selection and scroll restoration');
  check(session.readStageSession(storage,'workspace-B').stage === 'all', 'Workspace project isolation');
  check(!session.saveStageSession(storage,'',value), 'No unauthenticated project persistence');
  check(!session.saveStageSession(broken,'A',value), 'Storage failures nonfatal');
  check(session.readStageSession(broken,'A').stage === 'all', 'Storage read failures fallback');
  data.set('a4note.taskWorkspace.v1:workspace-A', '{bad json');
  check(session.readStageSession(storage,'workspace-A').stage === 'review', 'Malformed state retains valid legacy stage');
  data.set('a4note.taskWorkspace.v1:workspace-A', JSON.stringify({stage:'review',views:{review:{query:[],selectedId:{},top:-100,left:'bad'},unknown:{query:'invalid'}}}));
  const sanitized = session.readStageSession(storage,'workspace-A');
  check(sanitized.views.review.query === '' && sanitized.views.review.selectedId === null, 'Corrupt strings sanitized');
  check(sanitized.views.review.top === 0 && sanitized.views.review.left === 0, 'Corrupt scroll values sanitized');
  check(!sanitized.views.unknown, 'Unknown stage discarded');
  const render = props => renderToStaticMarkup(React.createElement(views.TaskStageWorkspace, {
    stage:'queued',tasks,agents:[],query:'',supportsQueue:true,onOpen:()=>{},onClearQuery:()=>{},overview:'OVERVIEW', ...props,
  }));
  for(const stage of statuses) {
    const html = render({stage});
    check(html.includes('阶段总数 1'), 'Count displayed ' + stage);
    check(!html.includes('<script>'), 'Unsafe title escaped ' + stage);
  }
  check(render({stage:'all'}).includes('OVERVIEW'), 'Reuse overview slot');
  check(!render({stage:'all',error:'失联'}).includes('OVERVIEW'), 'Error hides stale overview');
  check(!render({error:'失联'}).includes('查看完整任务'), 'Error hides stale actions');
  check(render({loading:true}).includes('正在加载'), 'Loading distinct');
  check(render({tasks:[]}).includes('暂无任务'), 'Empty stage distinct');
  check(render({query:'no-match'}).includes('清空搜索'), 'Filter empty can clear');
  check(render({stage:'queued',supportsQueue:true}).includes('已发布，等待执行 Agent 原子领取'), 'Direct queue purpose is visible');
  check(!render({stage:'queued',supportsQueue:true}).includes('已批准队列'), 'No legacy approval gate');
  check(!render({stage:'archived',renderActions:()=>React.createElement('button',null,'MUTATE')}).includes('MUTATE'), 'Archive does not expose mutation slot');
  check(render({stage:'in_progress'}).includes('不推断完成百分比'), 'No fabricated progress');
  check(render({stage:'review'}).includes('检查实际效果'), 'Review action asks for actual effect check');
  check(render({stage:'review',selectedId:'review',reviewContent:'EVIDENCE'}).includes('EVIDENCE'), 'Selected review panel');
  check(!render({stage:'review',selectedId:'archived',reviewContent:'EVIDENCE'}).includes('EVIDENCE'), 'Stale selection evidence hidden');
  check(render({stage:'review',selectedId:'archived'}).includes('重新选择'), 'External transition explained');
  const nav = renderToStaticMarkup(React.createElement(views.TaskStageSwitcher, {value:'all',tasks,supportsQueue:true,onChange:()=>{}}));
  check((nav.match(/<button/g)||[]).length === 5, 'Five direct-flow buttons');
  check((nav.match(/aria-pressed="true"/g)||[]).length === 1, 'Single active view');
  check(!nav.includes('markdown-resource-mode-switch'), 'Task buttons cannot inherit editor two-column rules');
  check(!nav.includes('tb-stage-count'), 'Topbar buttons show names only');
  check(nav.includes('tb-stage-switch'), 'Dedicated task switch styling');
  const disabledNav = renderToStaticMarkup(React.createElement(views.TaskStageSwitcher, {value:'all',tasks,supportsQueue:true,disabled:true,onChange:()=>{}}));
  check((disabledNav.match(/disabled=""/g)||[]).length === 5, 'Host can lock switching during save/upload');
  console.log(`Task stage model + component checks passed: ${checks} assertions, isolated TypeScript diagnostics: 0`);
} finally { fs.rmSync(temp, {recursive:true,force:true}); }

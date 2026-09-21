import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.resolve('src/features/taskboard');
const temp = path.resolve('.tmp/task-acceptance-tests', String(process.pid));
fs.mkdirSync(temp, { recursive: true });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
const criterion = (id, extra = {}) => ({
  id, label: '标准' + id, expected: '预期' + id, capability: 'desktop', objective: true, screenshotRequired: true, ...extra,
});
const taskBase = {
  id: 'task-1', title: '验收接线', description: '说明', acceptance: '要求', status: 'review', priority: 'normal',
  owner: 'dev-1', revision: 7, spec_revision: 2, claimed_spec: 2, progress: '等待用户检查效果', result: '已完成',
  feedback: '', updated_at: '2026-09-19T01:00:00Z', created_at: '2026-09-18T01:00:00Z', delivery_revision: 1,
  acceptance_archive_run: null,
};
const runBase = {
  id: 'run-1', revision: 2, status: 'waiting', createdAt: Date.now() - 1000, expiresAt: Date.now() + 60000,
  claimedAt: null, completedAt: null, runnerId: null, capabilities: [], criteria: [criterion('c1')], reportHash: null,
  outcome: null,
  binding: {
    projectId: 'p-1', taskId: 'task-1', developerId: 'dev-1', specRevision: 2, planRevision: 1, deliveryRevision: 1,
    criteriaRevision: 1, mode: 'automatic',
    target: { kind: 'desktop', source: 'D:/apps/a4note.exe', version: '0.1.16', sha256: 'a'.repeat(64) },
  },
};
try {
  const files = ['TaskAcceptancePanel.tsx', 'TaskServiceNotice.tsx'];
  const program = ts.createProgram(files.map((f) => path.join(root, f)), {
    strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, types: ['react', 'react-dom', 'vite/client'],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  check(!diagnostics.length, '独立验收组件类型检查通过：' + ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (f) => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
  }));
  for (const file of files) {
    const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    }).outputText.replace(/import ['"][^'"]+\.css['"];?/g, '');
    fs.writeFileSync(path.join(temp, file.replace(/\.tsx$/, '.mjs')), output);
  }
  const { TaskAcceptancePanel, appendAcceptanceCriterion } = await import(pathToFileURL(path.join(temp, 'TaskAcceptancePanel.mjs')).href);
  const { TaskServiceNotice } = await import(pathToFileURL(path.join(temp, 'TaskServiceNotice.mjs')).href);
  const survivors = [criterion('c1'), criterion('c3')];
  const appended = appendAcceptanceCriterion(survivors);
  check(appended.map(item => item.id).join(',') === 'c1,c3,c2', '删除中间标准后新增ID仍唯一');
  check(survivors.length === 2 && appended[0] === survivors[0] && appended[1] === survivors[1], '新增不覆盖或改写已有标准');
  check(appendAcceptanceCriterion([])[0].id === 'c1', '空标准列表从c1开始');
  check(appendAcceptanceCriterion([criterion('custom'), criterion('c2')])[2].id === 'c1', '自定义ID与非连续ID均安全');
  for (let removed = 0; removed < 40; removed++) {
    const rows = Array.from({ length: 40 }, (_, i) => criterion('c' + (i + 1))).filter((_, i) => i !== removed);
    check(new Set(appendAcceptanceCriterion(rows).map(item => item.id)).size === 40, '删除任意一项后新增仍保持40个唯一ID');
  }
  const panel = (props) => renderToStaticMarkup(React.createElement(TaskAcceptancePanel, {
    task: taskBase, state: null, enabled: true, busy: false, onAction: async () => {}, ...props,
  }));
  const notice = (props) => renderToStaticMarkup(React.createElement(TaskServiceNotice, { snapshot: null, base: 'http://127.0.0.1:4319', ...props }));

  // 服务能力：旧服务必须明确说明受控升级，而不是把降级当成新版本
  let html = notice({});
  check(html.includes('直接任务队列未启用') || html.includes('未启用（旧服务）'), '旧服务明确标注直接任务队列未启用');
  check(html.includes('不会自动停止旧服务') || html.includes('不会自动停止旧服务'), '说明安装新版不会自动停止旧进程');
  check(html.includes('备份完整私有数据目录'), '升级指引要求先备份完整数据目录');
  check(html.includes('WAL'), '备份指引包含WAL/SHM，避免只复制主数据库');
  check(html.includes('不要发送连接凭据'), '升级指引不索要凭据');
  check(!html.includes('<script'), '能力提示不注入脚本');
  html = notice({ snapshot: { capabilities: { queue: true, acceptance: true }, project: { id: 'p', name: 'n' }, sequence: 1, tasks: [], agents: [] } });
  check(html.includes('已启用') && !html.includes('需要受控升级任务服务'), '新服务不再显示升级阻塞提示');
  check(html.includes('独立验收已启用'), '验收能力状态可见');

  // 未启用验收能力时不得提供可点击的验收操作
  html = panel({ enabled: false, state: { config: { mode: 'manual', revision: 0, specRevision: null, approvedBy: null, approvedAt: null, criteria: [] }, runs: [] } });
  check(html.includes('当前服务未启用独立验收能力'), '旧服务下明确说明验收不可用');
  const disabledRadios = (html.match(/<input[^>]*name="acceptance-mode"[^>]*>/g) ?? []);
  check(disabledRadios.length === 2 && disabledRadios.every((r) => r.includes('disabled')), '旧服务下方式选择被禁用');
  check(html.includes('保存验收方式与标准') && /保存验收方式与标准/.test(html), '旧服务下仍显示当前方式，但不可操作');

  const emptyState = { config: { mode: 'manual', revision: 0, specRevision: null, approvedBy: null, approvedAt: null, criteria: [] }, runs: [] };
  html = panel({ state: emptyState });
  check(html.includes('默认人工验收'), '默认人工验收说明可见');
  check(html.includes('开发Agent、派发者不能自行切换'), '权限边界对用户可见');
  check(html.includes('尚未批准标准'), '未批准标准时明确提示');
  check(html.includes('先批准验收标准，才能发起验收请求'), '没有标准时不能发起请求');
  check(panel({ state: null }).includes('正在读取验收状态'), '验收状态加载中不伪造结果');

  // 已批准自动验收标准
  const approved = { config: { mode: 'automatic', revision: 1, specRevision: 2, approvedBy: 'human', approvedAt: Date.now(), criteria: [criterion('c1')] }, runs: [] };
  html = panel({ state: approved });
  check(html.includes('value="c1"'), '已批准标准回填到编辑区');
  const enabledRadios = (html.match(/<input[^>]*name="acceptance-mode"[^>]*>/g) ?? []);
  check(enabledRadios.length === 2 && enabledRadios.every((r) => !r.includes('disabled')), '新服务下用户可以切换验收方式');
  check(enabledRadios.some((r) => r.includes('checked')), '当前方式在界面上被选中');
  check(html.includes('自动验收须全部标准可判定'), '自动模式的判定限制可见');
  check(html.includes('发起独立验收请求'), '待检查任务可发起独立验收');
  check(html.includes('cli.mjs acceptance'), '提供验收Agent实际接入命令，而不是只有按钮');
  check(html.includes('开发会话不能验收自己的交付'), '独立性限制对用户可见');

  // 非待检查状态不能发起请求
  html = panel({ task: { ...taskBase, status: 'in_progress' }, state: approved });
  check(!html.includes('发起独立验收请求'), '执行中任务不显示发起入口');
  check(html.includes('只有已提交的待检查交付可以发起验收请求'), '说明为何不能发起');

  // 等待/执行/结束状态
  html = panel({ state: { ...approved, runs: [{ ...runBase, status: 'waiting', revision: 1 }] } });
  check(html.includes('等待验收Agent'), '无执行者时显示等待，而不是自动通过');
  check(html.includes('不会自动判通过'), '明确不会自动判定通过');
  check(html.includes('已有进行中的请求'), '进行中请求阻止重复发起');
  check(html.includes('取消验收请求'), '用户可取消进行中的请求');
  html = panel({ state: { ...approved, runs: [{ ...runBase, status: 'running', revision: 2, runnerId: 'verifier-1', claimedAt: Date.now(), capabilities: ['desktop'] }] } });
  check(html.includes('验收执行中') && html.includes('真实桌面'), '执行中与声明能力可见');
  check(html.includes('sha256:'), '被测构建指纹可见');
  const completed = {
    ...runBase, status: 'completed', revision: 3, runnerId: 'verifier-1', claimedAt: Date.now() - 5000, completedAt: Date.now(),
    capabilities: ['desktop'],
    outcome: { decision: 'needs_human_review', reasons: ['c1：failed', 'c1：主观标准需人工确认'] },
    report: { environment: '隔离环境', target: runBase.binding.target, checks: [{ id: 'c1', capability: 'desktop', expected: '预期c1', status: 'failed', actual: '未通过', steps: '打开被测版本' }], reportAttachmentId: 'a-1' },
  };
  html = panel({ state: { ...approved, runs: [completed] } });
  check(html.includes('需要人工确认，未自动归档'), '未通过时明确不自动归档');
  check(html.includes('c1：failed'), '失败原因逐项可见');
  check(html.includes('报告检查项'), '可查看结构化报告检查项');
  check(!html.includes('取消验收请求'), '已结束请求不提供取消');
  html = panel({ state: { ...approved, runs: [{ ...completed, outcome: { decision: 'eligible_for_auto_archive', reasons: [] } }] } });
  check(html.includes('自动验收通过并已归档'), '自动归档结果被明确标记');
  check(html.includes('全部批准标准通过且证据有效'), '通过条件可见');

  // 自动归档后的用户复核途径
  html = panel({ task: { ...taskBase, status: 'archived', acceptance_archive_run: 'run-1' }, state: { ...approved, runs: [{ ...completed, outcome: { decision: 'eligible_for_auto_archive', reasons: [] } }] } });
  check(html.includes('复核不通过，退回待检查'), '自动归档保留用户返工途径');
  check(html.includes('自动通过不代表用户满意'), '不把自动通过当成用户满意');
  check(!panel({ task: { ...taskBase, status: 'archived' }, state: approved }).includes('复核不通过'), '人工归档任务不显示自动验收返工入口');

  // 超时请求
  html = panel({ state: { ...approved, runs: [{ ...runBase, status: 'waiting', revision: 1, expiresAt: Date.now() - 1000 }] } });
  check(html.includes('已超时，须重新发起'), '超时请求明确失效');
  check(html.includes('发起独立验收请求'), '超时后可以重新发起');

  // 源码接线：草稿基线、直接队列、验收面板、请求取消
  const board = fs.readFileSync(path.join(root, 'TaskBoard.tsx'), 'utf8');
  check(board.includes('setEditRevision(detail.revision)'), '编辑开始时记录基线版本');
  check(/action: 'edit',\s*\n\s*revision: editRevision,/.test(board), '保存要求使用编辑基线版本');
  check(!/action: 'edit',\s*\n\s*revision: detail\.revision,/.test(board), '不再用刷新后的版本提交旧草稿');
  check(board.includes('editRevision !== detail.revision') && board.includes('重新载入最新要求'), '版本变化时保留草稿并要求重新载入');
  check(board.includes('disabled={busy || editRevision !== detail.revision}'), '版本不一致时禁止保存');
  check(!board.includes("choose(task.id, 'plan')") && !board.includes('TaskPlan'), '看板不再提供方案分区或方案按钮');
  check(board.includes("['queued', '任务队列'") && !board.includes("['backlog'"), '看板只保留直接任务队列，不显示积压列');
  check(board.includes('TaskAcceptancePanel') && board.includes('enabled={snapshot?.capabilities?.acceptance === true}'), '验收面板按服务能力启用');
  check(board.includes('acceptanceAction') && board.includes('client.acceptanceAction'), '验收操作接到服务接口');
  check(/const a = await c\.acceptance\(id\)/.test(board), '打开详情时读取验收状态');
  // 用户要求移除看板/侧栏说明文字；服务能力与接入状态不再以常驻文字呈现。
  check(!board.includes('TaskServiceNotice') && !board.includes('TaskOnboardingNotice'), '说明文字已按用户要求从看板移除');
  check(board.includes('isSameProjectPath(connection.projectRoot, project.path)'), '连接前仍校验服务返回目录与所选项目一致');
  check(board.includes('cancelPending'), '断开时取消未完成请求');
  check(board.includes('正在处理请求') && board.includes('取消等待'), '长时间请求可取消并提示结果未知');
  check(board.includes('写入结果可能已保存') || board.includes('写入操作可能已在服务端完成'), '取消/超时不暗示可盲目重试');

  const client = fs.readFileSync(path.resolve('src/platform/projectTasks.ts'), 'utf8');
  check(client.includes('private pending = new Set<AbortController>()'), '客户端跟踪未完成请求');
  check(client.includes('请求超时。写入结果可能已保存'), '普通请求有超时与明确提示');
  check((client.match(/redirect: 'error'/g) ?? []).length >= 3, '所有请求禁止跟随重定向');
  check(client.includes('acceptanceAction') && client.includes('AcceptanceState'), '客户端提供验收接口与类型');
  check(client.includes('delivery_revision'), '任务类型包含服务端交付版本');
  check(fs.existsSync(path.join(root, 'task-acceptance-panel.css')), '验收面板样式随组件提供');
  check(fs.readFileSync(path.join(root, 'TaskAcceptancePanel.tsx'), 'utf8').includes("import './task-acceptance-panel.css'"), '验收面板引入自身样式');

  console.log(`Task acceptance regression passed (${checks} assertions)`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

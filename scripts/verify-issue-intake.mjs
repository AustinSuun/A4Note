/* 分诊规则的回归：拿固定样本断言「什么样的 issue 会被判成什么」，全程离线。
   node scripts/verify-issue-intake.mjs */
import assert from 'node:assert/strict';
import { buildTriageReport, checkIssue, classifyKind, detectSecurity, parseSections, KIND, ROUTING } from './issue-intake-core.mjs';

const BUG_OK = `### A4Note 版本\n\n0.1.34\n\n### 平台\n\nWindows 11\n\n### 复现步骤\n\n1. 打开资料库\n2. 右键文件夹重命名\n\n### 期望结果\n\n改名后立刻生效\n\n### 实际结果\n\n名字回到旧值，控制台报错 console error\n\n### 截图 / 日志 / 录屏（可选）\n\n（已附）\n\n### 隐私确认\n\n- [x] 我已确认以上内容不含私人笔记`;

const SECURITY_OK = BUG_OK.replace('名字回到旧值，控制台报错 console error', '怀疑存在越权漏洞：普通账户可以读取他人资料库');

const FEATURE_OK = `### 你想解决的问题\n\n导出的 Markdown 里图片链接是本地路径，换电脑就断\n\n### 你期望的形态\n\n导出时把图片一起打包，或改成相对路径\n\n### 大概属于哪块\n\nMarkdown / 笔记`;

const INSTALL_MISSING = `### 安装方式\n\nWindows 安装包（.exe / NSIS）\n\n### 版本\n\n0.1.34\n\n### 卡在哪一步\n\n装完启动失败或闪退\n\n### 系统环境\n\nWindows 11 23H2，普通账户，火绒`;

/* ---------- 1. 分节解析 ---------- */
const sections = parseSections(BUG_OK);
assert.ok(sections.get('复现步骤').includes('右键文件夹重命名'), 'parseSections 应能取出分节内容');
assert.equal(parseSections('没有标题的正文').size, 0, '没有 ### 时不应产生分节');

/* ---------- 2. 版本前缀 + 标签都能定类型 ---------- */
assert.equal(classifyKind({ title: '[Bug] 重命名失效', body: '' }), KIND.bug);
assert.equal(classifyKind({ title: '[建议] 导出打包', body: '' }), KIND.feature);
assert.equal(classifyKind({ title: '[安装] 闪退', body: '' }), KIND.install);
assert.equal(classifyKind({ title: '随便写的', labels: [{ name: 'bug' }], body: '' }), KIND.bug);
assert.equal(classifyKind({ title: '随便写的', body: INSTALL_MISSING }), KIND.install, '能按模板特征识别安装类');

/* ---------- 3. 信息完整 → 可开工候选，且绝不自动授权 ---------- */
const ready = checkIssue({ number: 1, title: '[Bug] 重命名失效', body: BUG_OK, labels: [{ name: 'needs-triage' }] });
assert.equal(ready.routing, ROUTING.readyForTriage);
assert.deepEqual(ready.missing, []);
assert.ok(!ready.suggestedLabels.includes('agent:ready'), 'agent:ready 只能由人加，分诊器不许建议');
assert.ok(ready.suggestedLabels.includes('needs-triage'));

/* ---------- 4. 缺字段 → needs-info，并点名缺什么 ---------- */
const incomplete = checkIssue({ number: 2, title: '[Bug] 崩了', body: BUG_OK.replace('### 复现步骤\n\n1. 打开资料库\n2. 右键文件夹重命名\n\n', '### 复现步骤\n\n'), labels: [] });
assert.equal(incomplete.routing, ROUTING.incomplete);
assert.ok(incomplete.missing.includes('复现步骤'), '空的分节算缺失');
assert.ok(incomplete.suggestedLabels.includes('needs-info'));
assert.equal(checkIssue({ number: 3, title: '[安装] 闪退', body: INSTALL_MISSING, labels: [] }).routing, ROUTING.incomplete);
assert.ok(checkIssue({ number: 3, title: '[安装] 闪退', body: INSTALL_MISSING, labels: [] }).missing.includes('报错原文'));

/* ---------- 5. 空白/过短正文拦得住 ---------- */
assert.equal(checkIssue({ number: 4, title: '[Bug] x', body: '', labels: [] }).routing, ROUTING.incomplete);
assert.ok(checkIssue({ number: 4, title: '[Bug] x', body: '', labels: [] }).missing.some((item) => item.includes('正文')));
assert.equal(checkIssue({ number: 5, title: '[Bug] x', body: '坏了', labels: [] }).routing, ROUTING.incomplete);

/* ---------- 6. 安全类分流优先于一切 ---------- */
assert.ok(detectSecurity({ title: '随便', body: SECURITY_OK }));
assert.equal(checkIssue({ number: 6, title: '[Bug] 越权', body: SECURITY_OK, labels: [{ name: 'agent:ready' }] }).routing, ROUTING.securityAdvisory,
  '哪怕已授权，安全问题也要转私密');
assert.ok(checkIssue({ number: 6, title: '[Bug] 越权', body: SECURITY_OK, labels: [] }).suggestedLabels.includes('security'));

/* ---------- 7. 授权标签驱动的队列 ---------- */
assert.equal(checkIssue({ number: 7, title: '[Bug] a', body: BUG_OK, labels: [{ name: 'agent:ready' }] }).routing, ROUTING.agentQueue);
assert.equal(checkIssue({ number: 8, title: '[Bug] a', body: BUG_OK, labels: [{ name: 'agent:working' }] }).routing, ROUTING.agentQueue);

/* ---------- 8. 报告分桶 ---------- */
const report = buildTriageReport([
  { number: 11, title: '[Bug] 完整', body: BUG_OK, labels: [] },
  { number: 12, title: '[Bug] 缺字段', body: BUG_OK.replace('### 实际结果\n\n名字回到旧值，控制台报错 console error\n\n', '### 实际结果\n\n'), labels: [] },
  { number: 13, title: '[Bug] 越权', body: SECURITY_OK, labels: [] },
  { number: 14, title: '[Bug] 开工中', body: BUG_OK, labels: [{ name: 'agent:working' }] },
]);
for (const heading of ['agent 队列', '可开工候选', '待补信息', '安全类']) {
  assert.ok(report.markdown.includes(heading), `报告应包含「${heading}」分桶`);
}
assert.deepEqual([
  report.buckets.readyForTriage.length,
  report.buckets.incomplete.length,
  report.buckets.securityAdvisory.length,
  report.buckets.agentQueue.length,
], [1, 1, 1, 1], '四个桶各应落一条');
assert.ok(report.markdown.includes('#11') && report.markdown.includes('#13') && !report.markdown.includes('#14 #'), '报告应逐条列出 issue 号');

console.log('Issue intake checks passed: 模板分节解析、类型判定、缺字段点名、安全分流（优先于授权）、agent 门禁标签、报告分桶。全部离线，不触网、不改任何状态。');

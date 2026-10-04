/* 公开问题板的只读分诊器 —— agent/维护者都能跑，不写任何 GitHub 状态。
   node scripts/issue-triage.mjs [--repo owner/name] [--limit 50]
                                 [--offline <issues.json>] [--md-out <path>] [--json-out <path>]
   证据/报告默认写到 .tmp/issue-intake/。 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildTriageReport, checkIssue, ROUTING } from './issue-intake-core.mjs';

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const repo = option('repo', process.env.GITHUB_REPOSITORY || null);
const limit = Number(option('limit', '50'));
const offline = option('offline', null);
const outRoot = path.join(process.cwd(), '.tmp', 'issue-intake');
const mdOut = path.resolve(option('md-out', path.join(outRoot, 'report.md')));
const jsonOut = path.resolve(option('json-out', path.join(outRoot, 'report.json')));

function loadIssues() {
  if (offline) return JSON.parse(fs.readFileSync(offline, 'utf8'));
  const callArgs = ['issue', 'list', '--state', 'open', '--limit', String(limit),
    '--json', 'number,title,body,labels,createdAt,author,url'];
  if (repo) callArgs.push('--repo', repo);
  try {
    return JSON.parse(execFileSync('gh', callArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    console.error('读取 issue 失败：确认已安装 gh 并登录（gh auth status）。');
    console.error(String(error?.stderr || error?.message || error).trim());
    process.exit(2);
  }
}

const issues = loadIssues();
const report = buildTriageReport(issues);
fs.mkdirSync(outRoot, { recursive: true });
fs.writeFileSync(mdOut, report.markdown, 'utf8');
fs.writeFileSync(jsonOut, JSON.stringify({
  generatedAt: new Date().toISOString(),
  repo,
  counts: {
    total: issues.length,
    agentQueue: report.buckets.agentQueue.length,
    readyForTriage: report.buckets.readyForTriage.length,
    incomplete: report.buckets.incomplete.length,
    securityAdvisory: report.buckets.securityAdvisory.length,
  },
  issues: report.entries.map(({ issue, verdict }) => ({
    number: issue.number,
    title: issue.title,
    url: issue.url,
    kind: verdict.kind,
    routing: verdict.routing,
    missing: verdict.missing,
    suggestedLabels: verdict.suggestedLabels,
    note: verdict.note,
  })),
}, null, 2) + '\n', 'utf8');

const print = ({ issue, verdict }) => {
  const mark = verdict.routing === ROUTING.agentQueue ? '🟢' : verdict.routing === ROUTING.readyForTriage ? '🟡'
    : verdict.routing === ROUTING.securityAdvisory ? '🚫' : '🔴';
  console.log(`  ${mark} #${issue.number} ${issue.title}${verdict.missing.length ? `  (缺：${verdict.missing.join('、')})` : ''}`);
};
console.log(`问题板分诊（${repo ?? '当前仓库'}，共 ${issues.length} 条，只读）：`);
console.log(`🟢 agent 队列 ${report.buckets.agentQueue.length}：`); report.buckets.agentQueue.forEach(print);
console.log(`🟡 可开工候选 ${report.buckets.readyForTriage.length}：`); report.buckets.readyForTriage.forEach(print);
console.log(`🔴 待补信息 ${report.buckets.incomplete.length}：`); report.buckets.incomplete.forEach(print);
console.log(`🚫 安全类 ${report.buckets.securityAdvisory.length}：`); report.buckets.securityAdvisory.forEach(print);
console.log(`\n报告：${path.relative(process.cwd(), mdOut)} / ${path.relative(process.cwd(), jsonOut)}`);

/* 分诊器永远是「只读 + 退出码 0」：判断对错留给人和 verify 脚本，别让 CI 因分诊结果挂掉。 */
const misconfigured = issues.some((issue) => !issue.number || typeof issue.title !== 'string');
if (misconfigured) { console.error('输入里缺少 number/title 字段，检查 gh 输出或 --offline 文件。'); process.exit(3); }
process.exit(0);

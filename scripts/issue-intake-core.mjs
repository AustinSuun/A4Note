/* 公开问题板的分诊规则（纯逻辑，无 I/O）。
   规则与出口标签见 docs/issue-intake.md；这里只做「读得懂、判得准」，不写任何东西。

   关键约束（别改）：
   - 只有人（维护者/调度员）能加 `agent:ready`。本模块永远不会建议这个标签。
   - 命中安全关键词的 issue 一律转私密漏洞报告，不进入公开分诊。 */

export const KIND = Object.freeze({
  bug: 'bug',
  feature: 'feature',
  install: 'install',
  security: 'security',
  unknown: 'unknown',
});

export const ROUTING = Object.freeze({
  agentQueue: 'agent-queue',          // 已授权/进行中：agent 可以开工
  readyForTriage: 'ready-for-triage', // 信息完整，等人加 agent:ready
  incomplete: 'incomplete',           // 缺字段，需要 needs-info 回复
  securityAdvisory: 'security-advisory',
  unknown: 'unknown',
});

/* 模板要求的分节标题（按关键词匹配，模板文案微调不会让规则失效）。 */
const REQUIRED_SECTIONS = {
  [KIND.bug]: ['版本', '平台', '复现步骤', '期望', '实际'],
  [KIND.feature]: ['你想解决的问题', '你期望的形态', '大致属于哪块'],
  [KIND.install]: ['安装方式', '版本', '卡在哪一步', '报错原文', '系统环境'],
};

/* 只做「分流」，不做内容审查：命中即转私密报告，宁可多转一次。 */
const SECURITY_PATTERNS = [
  /漏洞|0day|zero[- ]day/i,
  /越权|提权|权限提升|绕过鉴权|绕过授权/,
  /注入|XSS|CSRF|反序列化|RCE/,
  /敏感信息泄露|泄露(了)?(我的)?(数据|凭据|密钥|token)/i,
  /(api[_ -]?key|access[_ -]?token|private[_ -]?key|密码|口令).{0,12}(泄漏|泄露|明文|曝光)/,
];

const TITLE_KINDS = [
  [/^\[bug\]/i, KIND.bug],
  [/^\[建议\]|^\[功能/, KIND.feature],
  [/^\[安装\]/, KIND.install],
];

const LABEL_KINDS = [
  ['bug', KIND.bug],
  ['enhancement', KIND.feature],
  ['install', KIND.install],
];

const MIN_BODY_CHARS = 40;

/** 把 issue 正文按 `### 标题` 切成 { 标题: 内容 }。 */
export function parseSections(body) {
  const sections = new Map();
  let current = null;
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const heading = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1];
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) sections.get(current).push(line);
  }
  const out = new Map();
  for (const [heading, lines] of sections) out.set(heading, lines.join('\n').trim());
  return out;
}

function findSection(sections, keyword) {
  for (const [heading, value] of sections) if (heading.includes(keyword)) return { heading, value };
  return null;
}

export function classifyKind(issue) {
  const title = String(issue?.title ?? '');
  for (const [pattern, kind] of TITLE_KINDS) if (pattern.test(title)) return kind;
  const labels = (issue?.labels ?? []).map((label) => (typeof label === 'string' ? label : label?.name) ?? '');
  for (const [label, kind] of LABEL_KINDS) if (labels.includes(label)) return kind;
  const sections = parseSections(issue?.body);
  if (findSection(sections, '复现步骤')) return KIND.bug;
  if (findSection(sections, '卡在哪一步')) return KIND.install;
  if (findSection(sections, '你想解决的问题')) return KIND.feature;
  return KIND.unknown;
}

export function detectSecurity(issue) {
  const haystack = `${issue?.title ?? ''}\n${issue?.body ?? ''}`;
  return SECURITY_PATTERNS.some((pattern) => pattern.test(haystack));
}

function labelNames(issue) {
  return (issue?.labels ?? []).map((label) => (typeof label === 'string' ? label : label?.name) ?? '');
}

/** 一条 issue 的判定结果。只输出结论与建议，不改任何状态。 */
export function checkIssue(issue) {
  const labels = labelNames(issue);
  const kind = classifyKind(issue);
  const sections = parseSections(issue?.body);
  const bodyLength = String(issue?.body ?? '').trim().length;

  const missing = [];
  for (const keyword of REQUIRED_SECTIONS[kind] ?? []) {
    const found = findSection(sections, keyword);
    if (!found || found.value.length === 0) missing.push(keyword);
  }
  if (bodyLength === 0) missing.push('正文（整个模板都没填）');
  else if (bodyLength < MIN_BODY_CHARS) missing.push('正文过短（看不出具体现象）');

  if (detectSecurity(issue)) {
    return {
      kind: KIND.security,
      routing: ROUTING.securityAdvisory,
      missing,
      suggestedLabels: ['security'],
      note: '在公开 issue 里讨论安全问题等于公开利用方法：转 security/advisories/new 私密跟进，公开 issue 只留一句指路。',
    };
  }
  if (labels.includes('agent:working')) {
    return { kind, routing: ROUTING.agentQueue, missing, suggestedLabels: [], note: '已在 agent 处理中；不要重复认领，检查是否有新的评论/复现信息。' };
  }
  if (labels.includes('agent:ready')) {
    return { kind, routing: ROUTING.agentQueue, missing, suggestedLabels: [], note: '已被授权（agent:ready）：可以开工，开工时改为 agent:working。' };
  }
  if (missing.length) {
    return {
      kind,
      routing: ROUTING.incomplete,
      missing,
      suggestedLabels: ['needs-info'],
      note: `缺 ${missing.join('、')}：回一条列清缺什么的评论即可，不要猜。`,
    };
  }
  if (kind === KIND.unknown) {
    return { kind, routing: ROUTING.incomplete, missing: ['模板'], suggestedLabels: ['needs-info'], note: '不是模板格式：请作者按对应模板重填。' };
  }
  return {
    kind,
    routing: ROUTING.readyForTriage,
    missing: [],
    suggestedLabels: ['needs-triage'],
    note: '信息齐了：等人加 agent:ready（只有人能加），然后按 docs/issue-intake.md 的闭环走。',
  };
}

/** 给一份 issue 列表（gh 的 JSON 形状）生成分桶报告。 */
export function buildTriageReport(issues) {
  const buckets = { agentQueue: [], readyForTriage: [], incomplete: [], securityAdvisory: [] };
  const entries = [];
  for (const issue of issues) {
    const verdict = checkIssue(issue);
    entries.push({ issue, verdict });
    if (verdict.routing === ROUTING.agentQueue) buckets.agentQueue.push({ issue, verdict });
    else if (verdict.routing === ROUTING.readyForTriage) buckets.readyForTriage.push({ issue, verdict });
    else if (verdict.routing === ROUTING.securityAdvisory) buckets.securityAdvisory.push({ issue, verdict });
    else buckets.incomplete.push({ issue, verdict });
  }
  const lines = ['# 问题板分诊报告', ''];
  const section = (title, list, render) => {
    lines.push(`## ${title}（${list.length}）`, '');
    if (!list.length) lines.push('（空）', '');
    for (const item of list) lines.push(render(item), '');
  };
  const head = ({ issue, verdict }) =>
    `- #${issue.number} ${issue.title} ｜ ${verdict.kind}${verdict.missing.length ? ` ｜ 缺：${verdict.missing.join('、')}` : ''}`;
  section('🟢 agent 队列（已授权/进行中）', buckets.agentQueue, head);
  section('🟡 可开工候选（信息完整，等人加 agent:ready）', buckets.readyForTriage, head);
  section('🔴 待补信息（needs-info）', buckets.incomplete, head);
  section('🚫 安全类（转私密报告，禁止公开讨论）', buckets.securityAdvisory, head);
  return { markdown: lines.join('\n'), buckets, entries };
}

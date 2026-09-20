import fs from 'node:fs';
import path from 'node:path';
import { createAcceptanceFixtures, verifyFixtureInputs } from './acceptance-fixtures.mjs';

export const defaultStyleSample = `# 标题一级

## 标题二级

正文段落：这是一段用于验收对比的中文长文本，覆盖字体、行高与折行表现，确保样式改动在真实渲染条件下可核对，而不是只检查代码。

> 引用/Callout：提示块与引用块的边距、底色和左侧标记。

- 无序列表第一项
- 无序列表第二项
  - 嵌套列表项

1. 有序列表第一项
2. 有序列表第二项

| 列A | 列B |
| --- | --- |
| 单元格 | 单元格 |

\`\`\`ts
export const sample = (value: number): number => value + 1;
\`\`\`

[链接示例](https://example.invalid) 与图片占位说明。
`;

export function defaultNote(task, criterionLabels) {
  return `# 验收测试笔记（隔离夹具）

任务：${task.title}
需求版本：v${task.spec_revision}
交付版本：v${task.delivery_revision ?? 0}

本文件是验收专用夹具，不属于真实笔记，不能提交到Git，也不修改用户资料或全局设置。

## 验收范围

${criterionLabels.length ? criterionLabels.map(label => '- ' + label).join('\n') : '- 见任务验收要求'}

## 最小复现步骤

1. 在独立数据/profile/IPC环境打开本笔记与样式样例。
2. 按批准的验收标准逐项操作并记录实际结果。
3. 截图仅覆盖被测应用区域，标注角色、版本与捕获时间。
`;
}

/** Local helper for an acceptance runner. The server never writes into the user's
 * project; the authorized root comes from the CLI's own project binding. */
export async function createFixturesForRun({ call, session, config, taskId, runId, needsNotes, json, manifestOut, now, note, sample, environment, authorizedProjectRoot }) {
  const state = await call('/tasks/' + taskId + '/acceptance');
  const run = state.runs.find(r => r.id === runId);
  if (!run) throw Error('验收请求不存在');
  if (run.status !== 'running') throw Error('仅执行中的验收请求可创建夹具');
  if (run.runnerId !== session.id) throw Error('只有领取本请求的验收会话可创建夹具；开发会话不能验收自己的交付');
  const task = await call('/tasks/' + taskId);
  const input = json ? JSON.parse(fs.readFileSync(json, 'utf8')) : {};
  const manifest = createAcceptanceFixtures({
    authorizedProjectRoot: authorizedProjectRoot ?? input.authorizedProjectRoot ?? config.projectRoot,
    taskId, runId, needsNotes: needsNotes === true,
    note: note ?? input.note ?? defaultNote(task, run.criteria.map(c => `${c.id}：${c.label}（预期：${c.expected}）`)),
    sample: sample ?? input.sample ?? defaultStyleSample,
    environment: environment ?? input.environment ?? '独立数据目录/profile/IPC，未操作用户现用实例；窗口尺寸、缩放与主题在报告中记录。',
    binding: { taskId, deliveryRevision: run.binding.deliveryRevision, criteriaRevision: run.binding.criteriaRevision,
      buildSha256: run.binding.target.sha256 },
  }, now);
  if (manifestOut && manifest.created) {
    fs.mkdirSync(path.dirname(path.resolve(manifestOut)), { recursive: true, mode: 0o700 });
    fs.writeFileSync(manifestOut, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  }
  return manifest;
}

export function verifyFixtures({ config, json, projectRoot }) {
  const manifest = JSON.parse(fs.readFileSync(json, 'utf8'));
  return verifyFixtureInputs(projectRoot ?? config.projectRoot, manifest);
}

import type { Agent, Detail, TaskClient } from '../../platform/projectTasks';
import { TaskAttachments } from './TaskImageViewer';
import './task-review-summary.css';

/** Shared by the stage workspace and full detail; no inference of an independent verdict. */
export function TaskReviewSummary({ task, client, agents, onOpen }: {
  task: Detail; client: TaskClient; agents: readonly Agent[]; onOpen?: () => void;
}) {
  const submission = [...task.events].filter(event => event.kind === 'task.submit').sort((a, b) => b.seq - a.seq)[0];
  const images = task.attachments.filter(file => file.mime.startsWith('image/') && !file.retired_at);
  const results = images.filter(file => file.purpose === 'result');
  const references = images.filter(file => file.purpose !== 'result');
  const files = task.attachments.filter(file => !file.mime.startsWith('image/') || file.retired_at);
  const author = agents.find(agent => agent.id === task.owner)?.alias ?? task.owner ?? '未记录';
  return <section className="tb-review-summary" aria-label="交付证据摘要">
    <header><h3>{task.title}</h3>{onOpen && <button type="button" onClick={onOpen}>打开完整详情与人工审核</button>}</header>
    <p>开发 Agent：{author} · 需求 v{task.spec_revision}</p>
    <p>{submission ? `最近提交记录 #${submission.seq} · ${new Date(submission.created_at).toLocaleString('zh-CN')}` : '提交时间未记录'} · 构建/代码指纹以交付原文为准，不把记录序号当构建版本。</p>
    <div className="tb-review-caution" role="note">开发自述不等于独立验收。当前服务未提供结构化独立验收评价；通过、未测项及运行条件须核对报告，不推断全部通过。</div>
    <h4>开发交付说明（未结构化原文）</h4>
    <p className="tb-review-excerpt">{task.result ? task.result.slice(0, 480) : '尚未提供交付说明'}</p>
    {task.result.length > 480 && <details><summary>展开完整开发报告</summary><pre>{task.result}</pre></details>}
    <h4>实际结果截图 · {results.length}</h4>
    {!results.length && <p>尚未提供实际结果截图，不能用需求参考图代替。</p>}
    <p className="tb-review-caution">现有附件没有结构化运行/构建/环境绑定。图片仅供人工核对；对比不代表同条件前后对照，也不证明属于当前交付。</p>
    <TaskAttachments key={`${task.id}:results`} files={results} client={client} readonly remove={() => {}} />
    <details><summary>需求参考与复现图片 · {references.length}</summary>
      <TaskAttachments key={`${task.id}:references`} files={references} client={client} readonly remove={() => {}} />
    </details>
    <details><summary>报告、其他附件与已替代证据 · {files.length}</summary>
      <TaskAttachments key={`${task.id}:files`} files={files} client={client} readonly remove={() => {}} />
    </details>
    {task.feedback && <section><h4>人工反馈原文</h4><pre>{task.feedback}</pre></section>}
  </section>;
}

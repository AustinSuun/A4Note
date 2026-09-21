import {useState, type ReactNode} from 'react';
import type { Agent, Detail, TaskClient } from '../../platform/projectTasks';
import { TaskAttachments } from './TaskImageViewer';
import './task-review-summary.css';

/** Shared by the stage workspace and full detail; no inference of an independent verdict.
 *  Result screenshots and the delivery conclusion come first; provenance notes stay one click away. */
export function TaskReviewSummary({ task, client, agents, onOpen, variant = 'stage' }: {
  task: Detail; client: TaskClient; agents: readonly Agent[]; onOpen?: () => void; variant?: 'stage' | 'dialog';
}) {
  const [openPanels, setOpenPanels] = useState<Set<string>>(() => new Set());
  const submission = [...task.events].filter(event => event.kind === 'task.submit').sort((a, b) => b.seq - a.seq)[0];
  const images = task.attachments.filter(file => file.mime.startsWith('image/') && !file.retired_at);
  const results = images.filter(file => file.purpose === 'result');
  const references = images.filter(file => file.purpose !== 'result');
  const files = task.attachments.filter(file => !file.mime.startsWith('image/') || file.retired_at);
  const author = agents.find(agent => agent.id === task.owner)?.alias ?? task.owner ?? '未记录';
  const excerpt = task.result ? task.result.slice(0, 480) : '';
  const key = (name: string) => `tb-review-${task.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-${name}`;
  const toggle = (name: string) => setOpenPanels(current => { const next = new Set(current); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  const panel = (name: string, label: string, count: number | undefined, children: ReactNode) => {
    const open = openPanels.has(name); const id = key(name);
    return <div className="tb-review-secondary">
      <button type="button" className="tb-secondary-disclosure" aria-expanded={open} aria-controls={id} onClick={() => toggle(name)}>
        <span>{open ? '收起' : '查看'} {label}</span>{count !== undefined && <span className="tb-secondary-count">{count}</span>}
      </button>
      {open && <div id={id} className="tb-review-secondary-body">{children}</div>}
    </div>;
  };
  return <section className={'tb-review-summary is-' + variant} aria-label="交付证据摘要">
    <header>
      <h3>{variant === 'dialog' ? '交付成果与实际效果' : task.title}</h3>
      {onOpen && <button type="button" onClick={onOpen}>打开完整详情与人工审核</button>}
      <p className="tb-review-meta">开发 Agent：{author} · 需求 v{task.spec_revision} · {submission
        ? `提交记录 #${submission.seq} · ${new Date(submission.created_at).toLocaleString('zh-CN')}` : '提交时间未记录'}</p>
    </header>
    <TaskAttachments key={`${task.id}:results`} files={results} client={client} readonly remove={() => {}}
      heading={<h4 className="tb-review-heading">实际结果截图<span>{results.length}</span></h4>} />
    {!results.length && <p className="tb-review-empty">尚未提供实际结果截图，不能用需求参考图代替。</p>}
    <h4 className="tb-review-heading">交付结论</h4>
    <p className="tb-review-excerpt">{excerpt || '尚未提供交付说明'}</p>
    {task.result.length > 480 && panel('report', '完整开发报告', undefined, <pre>{task.result}</pre>)}
    <p className="tb-review-caution" role="note">开发自述不等于独立验收；请按截图和报告核对实际效果，不推断全部通过。</p>
    {panel('notes', '证据说明与限制', undefined, <div className="tb-review-notes">
      <p>当前服务未提供结构化独立验收评价；通过、未测项及运行条件须核对报告。</p>
      <p>现有附件没有结构化运行/构建/环境绑定。图片仅供人工核对；对比不代表同条件前后对照，也不证明属于当前交付。构建/代码指纹以交付原文为准，不把记录序号当构建版本。</p>
    </div>)}
    {panel('references', '需求参考与复现图片', references.length, <>
      <TaskAttachments key={`${task.id}:references`} files={references} client={client} readonly remove={() => {}} />
    </>)}
    {panel('files', '报告、其他附件与已替代证据', files.length, <>
      <TaskAttachments key={`${task.id}:files`} files={files} client={client} readonly remove={() => {}} />
    </>)}
    {task.feedback && <section><h4 className="tb-review-heading">人工反馈原文</h4><pre>{task.feedback}</pre></section>}
  </section>;
}

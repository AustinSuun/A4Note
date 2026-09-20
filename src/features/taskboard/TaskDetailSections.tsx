import type { Agent, Detail } from '../../platform/projectTasks';
import './task-detail-sections.css';
export const detailSections = [
  ['requirements', '任务要求'], ['execution', '执行记录'], ['evidence', '验收与证据'], ['history', '完整历史'],
] as const;
export type DetailSection = typeof detailSections[number][0];
export function TaskDetailNavigation({ value, onChange }: { value: DetailSection; onChange: (value: DetailSection) => void }) {
  return <nav className="tb-detail-tabs" aria-label="任务详情分区">{detailSections.map(([id, title]) =>
    <button type="button" key={id} aria-pressed={id === value} onClick={() => onChange(id)}>{title}</button>)}</nav>;
}
const labels: Record<string, string> = {
  'task.takeover': '离线任务已接管', 'task.takeover_authorization': '用户接管说明与原负责人记录', 'task.handoff': '结构化中断交接',
  'task.created': '发布需求', 'task.edit': '修改要求', 'task.submit_plan': '提交方案',
  'task.approve_plan': '人工通过方案', 'task.reject_plan': '退回方案', 'task.claim': 'Agent领取',
  'task.progress': '更新执行进度', 'task.acknowledge': '确认要求版本', 'task.submit': '提交交付',
  'task.archive': '人工验收归档', 'task.request_changes': '人工退回调整', 'task.release': '停止写入并交还',
  'task.release_stale': '用户交还离线任务', 'task.promote': '移入任务队列', 'task.delete': '用户删除任务',
};
export function TaskEventTimeline({ task, agents }: { task: Detail; agents: readonly Agent[] }) {
  return <section className="tb-event-timeline" aria-label="真实任务流转记录">
    <p>仅显示服务返回的实际记录（最近 {task.events.length} 条）；更早历史由服务保留，无记录的阶段不推断已完成。</p>
    <ol>{[...task.events].sort((a, b) => a.seq - b.seq).map(event => <li key={event.seq}>
      <strong>{labels[event.kind] ?? event.kind}</strong>
      <span> · {event.actor === 'human' ? '用户' : agents.find(a => a.id === event.actor)?.alias ?? event.actor} · {new Date(event.created_at).toLocaleString('zh-CN')}</span>
      <details><summary>记录 #{event.seq} · 查看原始事件与版本</summary><pre>{event.payload || '没有附加数据'}</pre></details>
    </li>)}</ol>
    {!task.events.length && <p>旧流程或当前服务没有返回历史记录。</p>}
  </section>;
}

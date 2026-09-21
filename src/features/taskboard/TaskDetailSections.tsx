import {useState} from 'react';
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
const statusLabels: Record<string, string> = {
  queued: '已发布，等待领取', in_progress: '正在执行', review: '等待人工检查', archived: '已归档', backlog: '待整理',
};
const actorName = (actor: string, agents: readonly Agent[]) => actor === 'human'
  ? '用户' : agents.find(a => a.id === actor)?.alias ?? actor;
const formatTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN');
};
function eventSummary(payload: string) {
  if (!payload) return '没有附加说明';
  try {
    const record = JSON.parse(payload) as Record<string, unknown>;
    const candidates = ['summary', 'progress', 'result', 'feedback', 'reason', 'message', 'remaining'];
    for (const key of candidates) if (typeof record[key] === 'string' && record[key]) return String(record[key]).replace(/\s+/g, ' ').slice(0, 180);
    if (record.handoff && typeof record.handoff === 'object') {
      const remaining = (record.handoff as Record<string, unknown>).remaining;
      if (typeof remaining === 'string' && remaining) return remaining.replace(/\s+/g, ' ').slice(0, 180);
    }
    const keys = Object.keys(record).slice(0, 4);
    return keys.length ? `已记录结构化字段：${keys.join('、')}，可通过“查看原始记录”核对。` : '已记录结构化事件数据，可通过“查看原始记录”核对。';
  } catch { /* Raw payload remains available through the explicit audit button. */ }
  const summary = payload.replace(/\s+/g, ' ').trim();
  return summary.length > 180 ? `${summary.slice(0, 177)}…` : summary;
}

export function TaskExecutionSummary({task, agent}: { task: Detail; agent?: Agent | null }) {
  const presence = !agent ? '尚未领取' : agent.presence === 'online' ? '在线' : agent.presence === 'offline' ? '失联' : '状态未知';
  return <section className="tb-execution-summary" aria-label="执行状态摘要">
    <div className="tb-execution-summary-item"><span>执行 Agent</span><strong>{agent?.alias ?? '尚未领取'}</strong><small>{agent?.role ?? '等待执行者'}</small></div>
    <div className="tb-execution-summary-item"><span>连接状态</span><strong>{presence}</strong><small>{agent ? `最近心跳：${formatTime(agent.last_seen)}` : '没有可用心跳记录'}</small></div>
    <div className="tb-execution-summary-item"><span>当前阶段</span><strong>{statusLabels[task.status] ?? task.status}</strong><small>{task.progress || '服务未提供额外进度'}</small></div>
  </section>;
}

export function TaskEventTimeline({ task, agents, limit }: { task: Detail; agents: readonly Agent[]; limit?: number }) {
  const [openRecords, setOpenRecords] = useState<Set<number>>(() => new Set());
  const sorted = [...task.events].sort((a, b) => a.seq - b.seq);
  const events = limit ? sorted.slice(-limit) : sorted;
  const toggle = (seq: number) => setOpenRecords(current => {
    const next = new Set(current);
    if (next.has(seq)) next.delete(seq); else next.add(seq);
    return next;
  });
  return <section className="tb-event-timeline" aria-label="真实任务流转记录">
    <p>{limit ? `仅显示最近 ${events.length} 条关键活动；` : `显示全部 ${events.length} 条服务记录；`}更早历史由服务保留，无记录的阶段不推断已完成。</p>
    {events.length ? <div className="tb-event-timeline-list" role="list">
      {events.map(event => {
        const open = openRecords.has(event.seq);
        const rawId = `tb-event-raw-${event.seq}`;
        return <article className="tb-event-item" role="listitem" key={event.seq}>
          <span className="tb-event-node" aria-hidden="true" />
          <div className="tb-event-content">
            <div className="tb-event-meta"><strong>{labels[event.kind] ?? `未知事件 · ${event.kind}`}</strong><span>{actorName(event.actor, agents)} · {formatTime(event.created_at)}</span></div>
            <p className="tb-event-summary">{eventSummary(event.payload)}</p>
            <button type="button" className="tb-event-raw-toggle" aria-expanded={open} aria-controls={rawId} onClick={() => toggle(event.seq)}>
              {open ? '隐藏原始记录' : '查看原始记录'} · #{event.seq}
            </button>
            {open && <div id={rawId} className="tb-event-raw" tabIndex={-1}><span>审计记录 #{event.seq} · {event.kind}</span><pre>{event.payload || '没有附加数据'}</pre></div>}
          </div>
        </article>;
      })}
    </div> : <p>旧流程或当前服务没有返回历史记录。</p>}
  </section>;
}

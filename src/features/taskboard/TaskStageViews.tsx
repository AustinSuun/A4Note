import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import type { Agent, Task } from '../../platform/projectTasks';
import { stageCounts, stageTaskFacts, taskStages, tasksForStage, type TaskStage } from './taskStageModel';
import '../../shared/segmented-mode-switch.css';
import './task-stage-views.css';

/** Controlled: the host guards unsaved edits/uploads BEFORE accepting onChange. */
export function TaskStageSwitcher({ value, disabled = false, onChange }: {
  value: TaskStage; tasks: readonly Task[]; supportsQueue: boolean; disabled?: boolean;
  onChange: (stage: TaskStage) => void;
}) {
  const nav = useRef<HTMLElement>(null);
  // Narrow hosts hide the scrollbar; keep the active stage reachable by scrolling only this strip, never the page.
  useEffect(() => {
    const strip = nav.current, button = strip?.querySelectorAll('button')[taskStages.findIndex(s => s.id === value)];
    if (!strip || !button || strip.scrollWidth <= strip.clientWidth) return;
    const box = strip.getBoundingClientRect(), target = button.getBoundingClientRect();
    if (target.left < box.left) strip.scrollLeft -= box.left - target.left + 8;
    else if (target.right > box.right) strip.scrollLeft += target.right - box.right + 8;
  }, [value]);
  return <nav className="tb-stage-nav" aria-label="任务流程视图" data-window-no-drag ref={nav}>
    <div className="tb-stage-switch" data-stage={value}
      style={{ '--tb-stage-columns': taskStages.length, '--tb-stage-index': taskStages.findIndex(s => s.id === value) } as CSSProperties}
      onKeyDown={e => {
        if (disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const index = taskStages.findIndex(s => s.id === value);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? taskStages.length - 1
          : (index + (e.key === 'ArrowRight' ? 1 : -1) + taskStages.length) % taskStages.length;
        onChange(taskStages[next].id);
        e.currentTarget.querySelectorAll('button')[next]?.focus();
      }}>
      {taskStages.map(stage => <button type="button" key={stage.id}
        className={value === stage.id ? 'active' : ''} aria-pressed={value === stage.id}
        disabled={disabled} onClick={() => onChange(stage.id)}
        title={stage.purpose}>
        {stage.label}
      </button>)}
    </div>
  </nav>;
}
const priorityLabel = { high: '高优先级', normal: '普通', low: '低优先级' };
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未记录' : date.toLocaleString('zh-CN');
}
/** No network or mutations. renderActions must retain the host's permission/version gates. */
export function TaskStageWorkspace({ stage, tasks, agents, query,
  loading = false, error = '', selectedId = null, onOpen, onClearQuery,
  renderActions, overview, reviewContent,
}: {
  stage: TaskStage; tasks: readonly Task[]; agents: readonly Agent[]; query: string;
  supportsQueue: boolean; loading?: boolean; error?: string; selectedId?: string | null;
  onOpen: (task: Task) => void; onClearQuery: () => void;
  renderActions?: (task: Task) => ReactNode; overview: ReactNode;
  /** Only pass a panel keyed to the current project and selected task. */
  reviewContent?: ReactNode;
}) {
  const headingId = useId();
  const config = taskStages.find(item => item.id === stage)!;
  const total = stageCounts(tasks)[stage];
  const visible = tasksForStage(tasks, stage, query, agents);
  const selectedVisible = visible.some(task => task.id === selectedId);
  const names = new Map(agents.map(agent => [agent.id, agent.alias]));
  let body: ReactNode;
  if (error) body = <div role="alert" className="tb-stage-empty">无法加载任务：{error}。旧任务操作已隐藏，请重试连接。</div>;
  else if (loading) body = <div role="status" className="tb-stage-empty">正在加载当前项目任务…</div>;
  else if (stage === 'all') body = overview;
  else if (!visible.length) body = <div role="status" className="tb-stage-empty">
    {query.trim() ? '没有符合当前搜索条件的任务。' : `${config.label}暂无任务。`}
    {query.trim() && <button type="button" onClick={onClearQuery}>清空搜索</button>}
  </div>;
  else body = <div className={`tb-stage-layout tb-stage-layout--${stage}`}>
    <ul className="tb-stage-list">{visible.map(task => <li key={task.id} className={`tb-stage-row${selectedId === task.id ? ' is-selected' : ''}`}>
      <div className="tb-stage-row-head"><span className={`tb-stage-priority is-${task.priority}`}>{priorityLabel[task.priority]}</span>
        <time dateTime={task.updated_at}>更新 {dateLabel(task.updated_at)}</time></div>
      <h3><button type="button" className="tb-stage-task-title" onClick={() => onOpen(task)}>{task.title}</button></h3>
      <p className="tb-stage-owner">{task.owner ? `负责 Agent：${names.get(task.owner) ?? '未知代号'} · ${task.owner.slice(0, 8)}` : '尚无负责 Agent'} · 需求 v{task.spec_revision}</p>
      <dl>{stageTaskFacts(task).map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
      <footer><button type="button" onClick={() => onOpen(task)}>{stage === 'review' ? '检查实际效果' : stage === 'archived' ? '查看结果与历史' : '查看完整任务'}</button>
        {stage !== 'archived' && renderActions?.(task)}</footer>
    </li>)}</ul>
    {stage === 'review' && <aside className="tb-stage-review" aria-label="验收证据与实际效果">
      {selectedVisible && reviewContent ? reviewContent : <p>{selectedId && !selectedVisible ? '所选任务已不在当前结果中，请重新选择。' : '选择任务查看结果、截图和实际效果。'}</p>}
    </aside>}
  </div>;
  return <section className="tb-stage-workspace" data-stage={stage} aria-labelledby={headingId} aria-busy={loading}>
    <header className="tb-stage-heading"><div><h2 id={headingId}>{config.label}</h2><p>{config.purpose}</p></div>
      <span>{query.trim() ? `匹配 ${visible.length} / 阶段总数 ${total}` : `阶段总数 ${total}`}</span></header>
    {query.trim() && <p className="tb-stage-query">当前搜索：{query} <button type="button" onClick={onClearQuery}>清空</button></p>}
    {body}
  </section>;
}

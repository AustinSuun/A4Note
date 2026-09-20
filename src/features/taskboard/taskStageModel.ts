import type { Agent, Task, TaskStatus } from '../../platform/projectTasks';

export type TaskStage = 'all' | 'queued' | 'in_progress' | 'review' | 'archived';
/** Backlog remains readable as a legacy database value until the controlled migration, but is shown in the queue. */
export function visibleTaskStage(status: TaskStatus): Exclude<TaskStage, 'all'> {
  return status === 'backlog' ? 'queued' : status;
}
export const taskStages: ReadonlyArray<{ id: TaskStage; label: string; purpose: string }> = [
  { id: 'all', label: '总览', purpose: '查看所有任务的流程与分布' },
  { id: 'queued', label: '任务队列', purpose: '已发布，等待执行 Agent 原子领取' },
  { id: 'in_progress', label: '正在进行', purpose: '跟踪执行进度、heartbeat 与负责 Agent' },
  { id: 'review', label: '待检查效果', purpose: '检查实际效果，满意后归档或退回队列' },
  { id: 'archived', label: '已归档', purpose: '检索交付结果与最终决定的原始记录' },
];
export function isTaskStage(value: unknown): value is TaskStage {
  return taskStages.some(stage => stage.id === value);
}
export function stageCounts(tasks: readonly Task[]): Record<TaskStage, number> {
  const counts = { all: tasks.length, queued: 0, in_progress: 0, review: 0, archived: 0 };
  for (const task of tasks) counts[visibleTaskStage(task.status)]++;
  return counts;
}
export function tasksForStage(tasks: readonly Task[], stage: TaskStage, query: string, agents: readonly Agent[] = []): Task[] {
  const search = query.trim().toLocaleLowerCase();
  const names = new Map(agents.map(agent => [agent.id, agent.alias]));
  const weight = { high: 0, normal: 1, low: 2 };
  return tasks.filter(task => (stage === 'all' || visibleTaskStage(task.status) === stage) && (!search ||
    [task.title, task.description, task.id, task.owner ?? '', names.get(task.owner ?? '') ?? ''].join('\n').toLocaleLowerCase().includes(search)))
    .sort((a, b) => {
      const priority = stage === 'queued' ? weight[a.priority] - weight[b.priority] : 0;
      return priority || b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id);
    });
}
export function stageTaskFacts(task: Task): Array<{ label: string; value: string }> {
  switch (visibleTaskStage(task.status)) {
    case 'queued': return [
      { label: '发布状态', value: task.status === 'backlog' ? '待一次性迁移至任务队列' : '已发布，等待执行 Agent 领取' },
      { label: '领取条件', value: task.owner ? '已有负责人，请刷新核对' : '无负责人；服务端将原子检查并领取' },
      { label: '执行依据', value: '任务说明、验收标准与参考附件；无方案审批闸门' },
    ];
    case 'in_progress': return [
      { label: '最新进度', value: task.progress || '尚未提交进度，不推断完成百分比' },
      { label: '反馈', value: task.feedback || '暂无反馈记录；不据此推断无阻塞' },
    ];
    case 'review': return [
      { label: '提交结果', value: task.result || '尚未提供交付说明' },
      { label: '验收标准', value: task.acceptance || '尚未填写验收标准' },
      { label: '实际效果', value: '打开详情核对结果、证据与未测项；确认满意后归档' },
    ];
    case 'archived': return [
      { label: '最终交付记录', value: task.result || '未记录交付说明' },
      { label: '反馈记录', value: task.feedback || '未记录反馈；归档保留历史附件与事件' },
    ];
  }
}
export type StageStorage = Pick<Storage, 'getItem' | 'setItem'>;
const storageKey = (projectId: string) => 'a4note.taskStage.v1:' + encodeURIComponent(projectId);
export function readTaskStage(storage: StageStorage | null, projectId: string): TaskStage {
  if (!storage || !projectId) return 'all';
  try { const value = storage.getItem(storageKey(projectId)); return isTaskStage(value) ? value : 'all'; }
  catch { return 'all'; }
}
export function writeTaskStage(storage: StageStorage | null, projectId: string, stage: TaskStage): boolean {
  if (!storage || !projectId || !isTaskStage(stage)) return false;
  try { storage.setItem(storageKey(projectId), stage); return true; } catch { return false; }
}

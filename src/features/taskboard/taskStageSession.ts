import { isTaskStage, readTaskStage, writeTaskStage, type StageStorage, type TaskStage } from './taskStageModel';

export type StageViewState = { query: string; selectedId: string | null; top: number; left: number };
export type StageSession = { stage: TaskStage; views: Partial<Record<TaskStage, StageViewState>> };
export const emptyStageView = (): StageViewState => ({ query: '', selectedId: null, top: 0, left: 0 });
const key = (project: string) => 'a4note.taskWorkspace.v1:' + encodeURIComponent(project);
export function readStageSession(storage: StageStorage | null, project: string): StageSession {
  const fallback: StageSession = { stage: readTaskStage(storage, project), views: {} };
  if (!storage || !project) return fallback;
  try {
    const data = JSON.parse(storage.getItem(key(project)) ?? 'null');
    if (!data || !isTaskStage(data.stage) || !data.views || typeof data.views !== 'object') return fallback;
    const views: StageSession['views'] = {};
    for (const [stage, value] of Object.entries(data.views)) {
      if (!isTaskStage(stage) || !value || typeof value !== 'object') continue;
      const v = value as Record<string, unknown>;
      views[stage] = {
        query: typeof v.query === 'string' ? v.query.slice(0, 1000) : '',
        selectedId: typeof v.selectedId === 'string' ? v.selectedId.slice(0, 160) : null,
        top: typeof v.top === 'number' && Number.isFinite(v.top) ? Math.max(0, v.top) : 0,
        left: typeof v.left === 'number' && Number.isFinite(v.left) ? Math.max(0, v.left) : 0,
      };
    }
    return { stage: data.stage, views };
  } catch { return fallback; }
}
export function saveStageSession(storage: StageStorage | null, project: string, value: StageSession): boolean {
  if (!storage || !project) return false;
  try { storage.setItem(key(project), JSON.stringify(value)); writeTaskStage(storage, project, value.stage); return true; }
  catch { return false; }
}

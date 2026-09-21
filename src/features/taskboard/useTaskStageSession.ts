import { useCallback, useRef, useState } from 'react';
import type { TaskStage } from './taskStageModel';
import { emptyStageView, readStageSession, saveStageSession, type StageSession, type StageViewState } from './taskStageSession';
function storage() { try { return window.localStorage; } catch { return null; } }
/** Persist only from explicit UI events, never write an old project's state on identity change. */
export function useTaskStageSession(projectId: string) {
  const [, setStored] = useState<unknown>(null);
  const fresh = useRef<{ projectId: string; data: StageSession } | null>(null);
  if (!fresh.current || fresh.current.projectId !== projectId) fresh.current = { projectId, data: readStageSession(storage(), projectId) };
  const current = fresh.current;
  const commit = useCallback((change: (value: StageSession) => StageSession, render = true) => {
    if (!projectId || fresh.current?.projectId !== projectId) return;
    const next = { projectId, data: change(fresh.current.data) };
    fresh.current = next;
    saveStageSession(storage(), projectId, next.data);
    if (render) setStored(next);
  }, [projectId]);
  const setStage = (stage: TaskStage) => commit(data => ({ ...data, stage }));
  const updateView = (value: Partial<StageViewState>, render = true) => commit(data => ({
    ...data, views: { ...data.views, [data.stage]: { ...emptyStageView(), ...data.views[data.stage], ...value } },
  }), render);
  return { stage: current.data.stage, view: current.data.views[current.data.stage] ?? emptyStageView(), setStage, updateView };
}

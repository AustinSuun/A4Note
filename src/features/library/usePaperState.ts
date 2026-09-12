import { useRef, useState } from 'react';
import type { createAsterCore } from '../../core/asterCore';
import { updateNativePaperState, type PaperStatePatch } from '../../platform/library';
import { isTauriRuntime } from '../../platform/nativeApi';

type Action = 'read' | 'favorite' | 'viewed';
/** Serialize a paper's user-state actions, and only publish after native success. */
export function usePaperState(aster: ReturnType<typeof createAsterCore>, onChanged: () => void, onError: (message: string) => void) {
  const queue = useRef(new Map<string, Promise<void>>());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const update = (paperId: string, action: Action) => {
    const previous = queue.current.get(paperId) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const paper = aster.documents.get(paperId);
      if (!paper) return;
      const request = action === 'read' ? { isRead: !paper.isRead } : action === 'favorite' ? { isFavorite: !paper.isFavorite } : { markViewed: true };
      const patch: PaperStatePatch = isTauriRuntime() ? await updateNativePaperState(paperId, request)
        : action === 'viewed' ? { lastViewedAt: new Date().toISOString() } : action === 'read' ? { isRead: !paper.isRead } : { isFavorite: !paper.isFavorite };
      aster.documents.updateState(paperId, patch); onChanged();
    });
    queue.current.set(paperId, task); setBusyIds(new Set(queue.current.keys()));
    void task.catch((error) => onError(String(error))).finally(() => {
      if (queue.current.get(paperId) === task) queue.current.delete(paperId);
      setBusyIds(new Set(queue.current.keys()));
    });
  };
  return { update, busyIds };
}

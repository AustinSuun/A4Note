import { invoke } from '@tauri-apps/api/core';
import type { PaperDocument } from '../../core/types';

export type PaperStatePatch = Partial<Pick<PaperDocument, 'isRead' | 'isFavorite' | 'lastViewedAt'>>;
export async function updateNativePaperState(paperId: string, request: { isRead?: boolean; isFavorite?: boolean; markViewed?: boolean }): Promise<PaperStatePatch> {
  const state = await invoke<{ is_read: boolean; is_favorite: boolean; last_viewed_at: number | null }>('update_paper_state', {
    request: { paper_id: paperId, is_read: request.isRead, is_favorite: request.isFavorite, mark_viewed: request.markViewed ?? false },
  });
  return { isRead: state.is_read, isFavorite: state.is_favorite, lastViewedAt: state.last_viewed_at == null ? undefined : new Date(state.last_viewed_at).toISOString() };
}

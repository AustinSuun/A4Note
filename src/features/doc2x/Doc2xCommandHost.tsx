import { useEffect } from 'react';
import { setDoc2xCommandHandlers } from '../../core/doc2xPlugin.ts';
import type { Doc2xLibraryEntry } from './useDoc2xEntry.ts';

/**
 * Headless install point for the Doc2X commands. The core plugin declares
 * `doc2x.account.*` and `doc2x.paper.translate`; the host supplies the work.
 * Mounting this at the app root keeps the commands usable before — and without —
 * the Doc2X panel.
 */
export function Doc2xCommandHost({
  entry,
  paperIds,
}: {
  entry: Doc2xLibraryEntry;
  /** Current selection: bulk selection when present, otherwise the selected paper. */
  paperIds: string[];
}) {
  useEffect(() => {
    return setDoc2xCommandHandlers({
      login: () => entry.login(),
      logout: () => entry.logout(),
      accountStatus: () => entry.accountStatus(),
      translateCurrentPaper: async () => {
        if (!paperIds.length) return '请先选择一篇文献，再运行 Doc2X 翻译。';
        return entry.translate(paperIds);
      },
    });
  }, [entry, paperIds]);
  return null;
}

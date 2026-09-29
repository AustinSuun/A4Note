/**
 * Native side of the title bar「打开 ▾」menu (task bcabb18d). The decision of
 * what the menu acts on is pure and lives in `workbench/openMenuTarget.ts`;
 * workbench/ may not call platform/, so App wires these in.
 */
import { revealPaperFile } from '../platform/nativeApi';
import { openPathInVSCode, revealPath } from '../platform/projects';
import type { OpenMenuTarget } from '../workbench/openMenuTarget';

/**
 * Opens the file manager with the active file selected. Files on disk go
 * through `reveal_path`; library papers through `reveal_paper_file`, which
 * resolves the stored PDF path from the library database.
 */
export function revealOpenMenuTarget(target: OpenMenuTarget) {
  if (target.reveal.type === 'paper') {
    return revealPaperFile({ paperId: target.reveal.paperId, kind: 'source', fileId: target.reveal.fileId });
  }
  return revealPath(target.reveal.path);
}

export function openOpenMenuPathInVSCode(path: string) {
  return openPathInVSCode(path);
}

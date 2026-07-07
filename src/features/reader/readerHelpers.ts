import type { ReactNode } from 'react';
import type { AnnotationType, PaperDocument, ReaderSidePanelTab, WorkbenchPanelContribution } from '../../core/types';
import type { PaperFileKind } from '../../platform/nativeApi';
import { zh } from '../../ui/zh';
import { AnnotationsIcon, ChatIcon, NotesIcon, RelationsIcon } from './ReaderIcons';
import type { ReaderContentMode, ReaderSaveState, ReaderSidePanelDefinition } from './types';

export function createReaderSidePanelDefinitions(panels: WorkbenchPanelContribution[]): ReaderSidePanelDefinition[] {
  return panels
    .map((panel) => {
      const id = readerPanelTabFromWorkbenchId(panel.id);
      return id ? { id, panel, commandId: panel.commandId, label: readerPanelLabel(id), commandTitle: readerPanelCommandTitle(id), icon: readerPanelIcon(panel.icon) } : null;
    })
    .filter((panel): panel is ReaderSidePanelDefinition => Boolean(panel));
}

export function preferredReaderMode(paper: PaperDocument | null): ReaderContentMode {
  if (!paper) return 'pdf';
  if (paper.sourcePdf || paper.translatedPdfs.length) return 'pdf';
  if (paper.notes.length) return 'markdown';
  return 'pdf';
}

export function preferredReaderFile(paper: PaperDocument | null): PaperFileKind {
  if (!paper) return 'source';
  return paper.sourcePdf ? 'source' : paper.translatedPdfs.length ? 'translated' : 'source';
}

export function preferredTranslatedFileId(paper: PaperDocument | null, currentFileId = '') {
  if (!paper?.translatedFileIds.length) return '';
  return currentFileId && paper.translatedFileIds.includes(currentFileId) ? currentFileId : paper.translatedFileIds[0];
}

export function readerPanelCommandTitle(tab: ReaderSidePanelTab) {
  const labels: Record<ReaderSidePanelTab, string> = {
    notes: zh.command.openNotesPanel,
    annotations: zh.command.openAnnotationsPanel,
    chat: zh.command.openChatPanel,
    relations: zh.command.openRelationsPanel,
  };
  return labels[tab];
}

export function annotationLabelText(type: AnnotationType) {
  if (type === 'comment') return zh.reader.commentLabel;
  if (type === 'underline') return zh.reader.underlineLabel;
  if (type === 'area') return zh.reader.areaLabel;
  return zh.reader.highlightLabel;
}

export function noteSaveStateText(state: ReaderSaveState) {
  if (state === 'saving') return zh.reader.noteSaving;
  if (state === 'dirty') return zh.reader.noteUnsaved;
  if (state === 'error') return zh.reader.noteSaveError;
  return zh.reader.noteSaved;
}

function readerPanelTabFromWorkbenchId(panelId: string): ReaderSidePanelTab | null {
  const prefix = 'reader.';
  if (!panelId.startsWith(prefix)) return null;
  const value = panelId.slice(prefix.length);
  return value === 'notes' || value === 'annotations' || value === 'chat' || value === 'relations' ? value : null;
}

function readerPanelLabel(tab: ReaderSidePanelTab) {
  const labels: Record<ReaderSidePanelTab, string> = {
    notes: zh.reader.panelNotes,
    annotations: zh.reader.panelAnnotations,
    chat: zh.reader.panelChat,
    relations: zh.reader.panelRelations,
  };
  return labels[tab];
}

function readerPanelIcon(icon: WorkbenchPanelContribution['icon']): () => ReactNode {
  const icons: Record<string, () => ReactNode> = {
    notes: NotesIcon,
    annotations: AnnotationsIcon,
    chat: ChatIcon,
    relations: RelationsIcon,
  };
  return icons[icon] ?? NotesIcon;
}

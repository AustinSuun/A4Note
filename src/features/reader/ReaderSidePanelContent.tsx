import type { ObjectNavigationTarget } from '../../core/relations';
import type { AnnotationColor, AiThreadContext, PaperDocument, PositionJson, ReaderSidePanelTab } from '../../core/types';
import type { PaperFileKind } from '../../platform/nativeApi';
import { AnnotationListPanel } from './AnnotationListPanel';
import { CitationPanel } from './CitationPanel';
import { MarkdownNotePanel } from './ReaderMarkdown';
import { ReaderChatPanel } from './ReaderChatPanel';
import { RelationPanel } from './RelationPanel';
import type { NoteDraftPatch, NoteSaveInput } from './types';

export function ReaderSidePanelContent({
  tab,
  paper,
  fileMode,
  translatedFileId,
  aiThreadContexts,
  focusedAnnotationId,
  noteDraftPatch,
  onNoteDraftPatchConsumed,
  onNoteSave,
  onCreateNote,
  onFocusAnnotation,
  onUpdateAnnotationComment,
  onUpdateAnnotationPosition,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onAppendAnnotationToNote,
  onNavigateAnnotation,
  onNavigateRelationTarget,
}: {
  tab: ReaderSidePanelTab;
  paper: PaperDocument;
  fileMode: PaperFileKind;
  translatedFileId: string;
  aiThreadContexts: AiThreadContext[];
  focusedAnnotationId: string | null;
  noteDraftPatch: NoteDraftPatch | null;
  onNoteDraftPatchConsumed: () => void;
  onNoteSave: (note: NoteSaveInput) => void | Promise<string | void>;
  onCreateNote: () => void | Promise<string | void>;
  onFocusAnnotation: (annotationId: string | null) => void;
  onUpdateAnnotationComment: (annotationId: string, comment: string) => void | Promise<void>;
  onUpdateAnnotationPosition: (annotationId: string, positionJson: PositionJson) => void | Promise<void>;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  onAppendAnnotationToNote: (annotationId: string) => void;
  onNavigateAnnotation: (annotationId: string) => void;
  onNavigateRelationTarget: (target: ObjectNavigationTarget | null) => void;
}) {
  if (tab === 'notes') {
    return (
      <MarkdownNotePanel
        paper={paper}
        draftPatch={noteDraftPatch}
        onDraftPatchConsumed={onNoteDraftPatchConsumed}
        onSave={onNoteSave}
        onCreateNote={onCreateNote}
        onNavigateAnnotation={onNavigateAnnotation}
      />
    );
  }

  if (tab === 'chat') {
    return <ReaderChatPanel paper={paper} />;
  }

  // 新 cite tab：引用（标注 + 关系）
  if (tab === 'cite') {
    return (
      <CitationPanel
        paper={paper}
        fileMode={fileMode}
        translatedFileId={translatedFileId}
        aiThreadContexts={aiThreadContexts}
        focusedAnnotationId={focusedAnnotationId}
        onFocusAnnotation={onFocusAnnotation}
        onUpdateAnnotationComment={onUpdateAnnotationComment}
        onUpdateAnnotationPosition={onUpdateAnnotationPosition}
        onUpdateAnnotationColor={onUpdateAnnotationColor}
        onDeleteAnnotation={onDeleteAnnotation}
        onAppendAnnotationToNote={onAppendAnnotationToNote}
        onNavigateAnnotation={onNavigateAnnotation}
        onNavigateRelationTarget={onNavigateRelationTarget}
      />
    );
  }

  // 旧版兼容：annotations tab 仍可单独展示
  if (tab === 'annotations') {
    return (
      <AnnotationListPanel
        paper={paper}
        fileMode={fileMode}
        translatedFileId={translatedFileId}
        focusedAnnotationId={focusedAnnotationId}
        onFocusAnnotation={onFocusAnnotation}
        onUpdateAnnotationComment={onUpdateAnnotationComment}
        onUpdateAnnotationPosition={onUpdateAnnotationPosition}
        onUpdateAnnotationColor={onUpdateAnnotationColor}
        onDeleteAnnotation={onDeleteAnnotation}
        onAppendToNote={onAppendAnnotationToNote}
      />
    );
  }

  // 旧版兼容：relations tab
  return <RelationPanel paper={paper} fileMode={fileMode} translatedFileId={translatedFileId} aiThreadContexts={aiThreadContexts} onNavigateTarget={onNavigateRelationTarget} />;
}

import type { ObjectNavigationTarget } from '../../core/relations';
import type { AnnotationColor, AiThreadContext, PaperDocument, PositionJson, ReaderSidePanelTab } from '../../core/types';
import type { PaperFileKind } from '../../platform/nativeApi';
import { AnnotationListPanel } from './AnnotationListPanel';
import { MarkdownNotePanel } from './ReaderMarkdown';
import { ReaderChatPanel } from './ReaderChatPanel';
import { RelationPanel } from './RelationPanel';
import type { NoteDraftPatch } from './types';

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
  onFocusAnnotation,
  onUpdateAnnotationComment,
  onUpdateAnnotationPosition,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onAppendAnnotationToNote,
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
  onNoteSave: (content: string) => void | Promise<void>;
  onFocusAnnotation: (annotationId: string | null) => void;
  onUpdateAnnotationComment: (annotationId: string, comment: string) => void | Promise<void>;
  onUpdateAnnotationPosition: (annotationId: string, positionJson: PositionJson) => void | Promise<void>;
  onUpdateAnnotationColor: (annotationId: string, color: AnnotationColor) => void | Promise<void>;
  onDeleteAnnotation: (annotationId: string) => void | Promise<void>;
  onAppendAnnotationToNote: (annotationId: string) => void;
  onNavigateRelationTarget: (target: ObjectNavigationTarget | null) => void;
}) {
  if (tab === 'notes') {
    return <MarkdownNotePanel paper={paper} draftPatch={noteDraftPatch} onDraftPatchConsumed={onNoteDraftPatchConsumed} onSave={onNoteSave} />;
  }
  if (tab === 'annotations') {
    return (
      <AnnotationListPanel
        paper={paper}
        fileMode={fileMode}
        translatedFileId={translatedFileId}
        focusedAnnotationId={focusedAnnotationId}
        onFocusAnnotation={(annotationId) => onFocusAnnotation(annotationId)}
        onUpdateAnnotationComment={onUpdateAnnotationComment}
        onUpdateAnnotationPosition={onUpdateAnnotationPosition}
        onUpdateAnnotationColor={onUpdateAnnotationColor}
        onDeleteAnnotation={onDeleteAnnotation}
        onAppendToNote={onAppendAnnotationToNote}
      />
    );
  }
  if (tab === 'chat') {
    return <ReaderChatPanel paper={paper} />;
  }
  return <RelationPanel paper={paper} fileMode={fileMode} translatedFileId={translatedFileId} aiThreadContexts={aiThreadContexts} onNavigateTarget={onNavigateRelationTarget} />;
}

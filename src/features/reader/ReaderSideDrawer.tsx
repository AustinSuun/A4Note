import type { ObjectNavigationTarget } from '../../core/relations';
import type { AnnotationColor, AiThreadContext, PaperDocument, PositionJson, ReaderSidePanelTab } from '../../core/types';
import type { PaperFileKind } from '../../platform/nativeApi';
import { WorkspacePanelHost } from '../../workbench';
import { zh } from '../../ui/zh';
import { ReaderSidePanelContent } from './ReaderSidePanelContent';
import type { NoteDraftPatch, ReaderSidePanelDefinition } from './types';

export function ReaderSideDrawer({
  open,
  sidePanels,
  sidePanelTab,
  paper,
  fileMode,
  translatedFileId,
  aiThreadContexts,
  focusedAnnotationId,
  noteDraftPatch,
  onSidePanelOpenChange,
  onSidePanelTabChange,
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
  open: boolean;
  sidePanels: ReaderSidePanelDefinition[];
  sidePanelTab: ReaderSidePanelTab;
  paper: PaperDocument;
  fileMode: PaperFileKind;
  translatedFileId: string;
  aiThreadContexts: AiThreadContext[];
  focusedAnnotationId: string | null;
  noteDraftPatch: NoteDraftPatch | null;
  onSidePanelOpenChange: (open: boolean) => void;
  onSidePanelTabChange: (tab: ReaderSidePanelTab) => void;
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
  if (!open) return null;
  return (
    <WorkspacePanelHost
      panels={sidePanels}
      activePanelId={sidePanelTab}
      className="reader-side-drawer"
      closeTitle={zh.reader.closePanel}
      onActivePanelChange={onSidePanelTabChange}
      onClose={() => onSidePanelOpenChange(false)}
      renderPanel={(tab) => (
        <ReaderSidePanelContent
          tab={tab}
          paper={paper}
          fileMode={fileMode}
          translatedFileId={translatedFileId}
          aiThreadContexts={aiThreadContexts}
          focusedAnnotationId={focusedAnnotationId}
          noteDraftPatch={noteDraftPatch}
          onNoteDraftPatchConsumed={onNoteDraftPatchConsumed}
          onNoteSave={onNoteSave}
          onFocusAnnotation={onFocusAnnotation}
          onUpdateAnnotationComment={onUpdateAnnotationComment}
          onUpdateAnnotationPosition={onUpdateAnnotationPosition}
          onUpdateAnnotationColor={onUpdateAnnotationColor}
          onDeleteAnnotation={onDeleteAnnotation}
          onAppendAnnotationToNote={onAppendAnnotationToNote}
          onNavigateRelationTarget={onNavigateRelationTarget}
        />
      )}
    />
  );
}

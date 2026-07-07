import type { ObjectNavigationTarget } from '../../core/relations';
import { ReaderDocumentPane } from './ReaderDocumentPane';
import { ReaderSideDrawer } from './ReaderSideDrawer';
import { ReaderToolbar } from './ReaderToolbar';
import { preferredTranslatedFileId } from './readerHelpers';
import type { ReaderSceneProps } from './types';

export function ReaderScene({
  paper,
  layout,
  contentMode,
  fileMode,
  translatedFileId,
  activeAnnotationTool,
  activeAnnotationColor,
  zoom,
  requestedPage,
  sidePanelOpen,
  sidePanelTab,
  aiThreadContexts,
  sidePanels,
  onLayoutChange,
  onContentModeChange,
  onFileModeChange,
  onTranslatedFileIdChange,
  onSelectAnnotationTool,
  onSelectAnnotationColor,
  customAnnotationColor,
  onCustomAnnotationColorChange,
  onZoomChange,
  onFitWidth,
  onSidePanelOpenChange,
  onSidePanelTabChange,
  onCreateAnnotation,
  onUpdateAnnotationComment,
  onUpdateAnnotationPosition,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  readerPageState,
  focusedAnnotationId,
  onReaderStateChange,
  onFocusAnnotation,
  onJumpToPage,
  onNoteSave,
  onCreateNote,
  noteDraftPatch,
  onNoteDraftPatchConsumed,
  onAppendAnnotationToNote,
}: ReaderSceneProps) {
  const currentTranslatedFileId = preferredTranslatedFileId(paper, translatedFileId);

  const navigateRelationTarget = (target: ObjectNavigationTarget | null) => {
    if (!target) return;
    if (target.kind === 'pdf_file') {
      onContentModeChange('pdf');
      if (target.fileKind === 'translated') {
        onTranslatedFileIdChange(target.fileId);
      }
      onFileModeChange(target.fileKind);
      return;
    }
    if (target.kind === 'note') {
      onContentModeChange('markdown');
      onSidePanelTabChange('notes');
      return;
    }
    if (target.kind === 'annotation') {
      onContentModeChange('pdf');
      if (paper.translatedFileIds.includes(target.fileId)) {
        onTranslatedFileIdChange(target.fileId);
        onFileModeChange('translated');
      } else {
        onFileModeChange('source');
      }
      if (target.page) onJumpToPage(target.page);
      onFocusAnnotation(target.annotationId);
      onSidePanelTabChange('annotations');
      return;
    }
    if (target.kind === 'ai_thread') {
      onSidePanelTabChange('chat');
    }
  };

  return (
    <section className="scene active">
      <ReaderToolbar
        paper={paper}
        layout={layout}
        contentMode={contentMode}
        fileMode={fileMode}
        currentTranslatedFileId={currentTranslatedFileId}
        activeAnnotationTool={activeAnnotationTool}
        activeAnnotationColor={activeAnnotationColor}
        customAnnotationColor={customAnnotationColor}
        zoom={zoom}
        readerPageState={readerPageState}
        sidePanelOpen={sidePanelOpen}
        sidePanelTab={sidePanelTab}
        sidePanels={sidePanels}
        onLayoutChange={onLayoutChange}
        onContentModeChange={onContentModeChange}
        onFileModeChange={onFileModeChange}
        onTranslatedFileIdChange={onTranslatedFileIdChange}
        onSelectAnnotationTool={onSelectAnnotationTool}
        onSelectAnnotationColor={onSelectAnnotationColor}
        onCustomAnnotationColorChange={onCustomAnnotationColorChange}
        onZoomChange={onZoomChange}
        onFitWidth={onFitWidth}
        onSidePanelTabChange={onSidePanelTabChange}
        onJumpToPage={onJumpToPage}
      />
      <div className={sidePanelOpen ? 'reader-layout drawer-open' : 'reader-layout'}>
        <ReaderDocumentPane
          paper={paper}
          contentMode={contentMode}
          fileMode={fileMode}
          currentTranslatedFileId={currentTranslatedFileId}
          activeAnnotationTool={activeAnnotationTool}
          zoom={zoom}
          activeAnnotationColor={activeAnnotationColor}
          requestedPage={requestedPage}
          focusedAnnotationId={focusedAnnotationId}
          onZoomChange={onZoomChange}
          onCreateAnnotation={onCreateAnnotation}
          onUpdateAnnotationComment={onUpdateAnnotationComment}
          onUpdateAnnotationPosition={onUpdateAnnotationPosition}
          onUpdateAnnotationColor={onUpdateAnnotationColor}
          onDeleteAnnotation={onDeleteAnnotation}
          onAppendAnnotationToNote={onAppendAnnotationToNote}
          onReaderStateChange={onReaderStateChange}
          onFocusAnnotation={onFocusAnnotation}
          onCreateNote={onCreateNote}
        />
        <ReaderSideDrawer
          open={sidePanelOpen}
          sidePanels={sidePanels}
          sidePanelTab={sidePanelTab}
          paper={paper}
          fileMode={fileMode}
          translatedFileId={currentTranslatedFileId}
          aiThreadContexts={aiThreadContexts}
          focusedAnnotationId={focusedAnnotationId}
          noteDraftPatch={noteDraftPatch}
          onSidePanelOpenChange={onSidePanelOpenChange}
          onSidePanelTabChange={onSidePanelTabChange}
          onNoteDraftPatchConsumed={onNoteDraftPatchConsumed}
          onNoteSave={onNoteSave}
          onFocusAnnotation={onFocusAnnotation}
          onUpdateAnnotationComment={onUpdateAnnotationComment}
          onUpdateAnnotationPosition={onUpdateAnnotationPosition}
          onUpdateAnnotationColor={onUpdateAnnotationColor}
          onDeleteAnnotation={onDeleteAnnotation}
          onAppendAnnotationToNote={onAppendAnnotationToNote}
          onNavigateRelationTarget={navigateRelationTarget}
        />
      </div>
    </section>
  );
}

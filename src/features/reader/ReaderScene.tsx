import { useState, type CSSProperties } from 'react';
import type { ObjectNavigationTarget } from '../../core/relations';
import { ReaderDocumentPane } from './ReaderDocumentPane';
import { ReaderProvider } from './ReaderContext';
import { ReaderSideDrawer } from './ReaderSideDrawer';
import { ReaderToolbar } from './ReaderToolbar';
import { preferredTranslatedFileId } from './readerHelpers';
import { defaultReaderToolSettings, type ReaderSceneProps, type ReaderToolSettings } from './types';

export function ReaderScene({
  paper,
  layout,
  contentMode,
  fileMode,
  translatedFileId,
  activeParallelFileKind,
  parallelSyncLocked,
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
  onActiveParallelFileKindChange,
  onParallelSyncLockedChange,
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
  const activeFileKind = fileMode === 'parallel' ? activeParallelFileKind : fileMode;
  const [sidePanelWidth, setSidePanelWidth] = useState(360);
  const [toolSettings, setToolSettings] = useState<ReaderToolSettings>(defaultReaderToolSettings);
  const readerLayoutStyle = sidePanelOpen
    ? ({ '--reader-side-width': `${sidePanelWidth}px` } as CSSProperties)
    : undefined;

  const navigateAnnotationId = (annotationId: string) => {
    const annotation = paper.annotations.find((item) => item.id === annotationId);
    if (!annotation) return;
    navigateAnnotationTarget(annotation.fileId, annotation.page, annotation.id);
  };

  const navigateAnnotationTarget = (fileId: string, page: number | undefined, annotationId: string) => {
    const targetFileKind = paper.translatedFileIds.includes(fileId) ? 'translated' : 'source';
    onContentModeChange('pdf');
    onActiveParallelFileKindChange(targetFileKind);
    if (targetFileKind === 'translated') onTranslatedFileIdChange(fileId);
    if (fileMode !== 'parallel') onFileModeChange(targetFileKind);
    if (page) onJumpToPage(page);
    onFocusAnnotation(annotationId);
    onSidePanelTabChange('annotations');
  };

  const navigateRelationTarget = (target: ObjectNavigationTarget | null) => {
    if (!target) return;
    if (target.kind === 'pdf_file') {
      onContentModeChange('pdf');
      if (target.fileKind === 'translated') onTranslatedFileIdChange(target.fileId);
      onActiveParallelFileKindChange(target.fileKind);
      if (fileMode !== 'parallel') onFileModeChange(target.fileKind);
      return;
    }
    if (target.kind === 'note') { onContentModeChange('markdown'); onSidePanelTabChange('notes'); return; }
    if (target.kind === 'annotation') { navigateAnnotationTarget(target.fileId, target.page ?? undefined, target.annotationId); return; }
    if (target.kind === 'ai_thread') onSidePanelTabChange('chat');
  };

  return (
    <ReaderProvider
      paper={paper}
      layout={layout}
      contentMode={contentMode}
      fileMode={fileMode}
      translatedFileId={currentTranslatedFileId}
      activeParallelFileKind={activeParallelFileKind}
      parallelSyncLocked={parallelSyncLocked}
      activeAnnotationTool={activeAnnotationTool}
      activeAnnotationColor={activeAnnotationColor}
      customAnnotationColor={customAnnotationColor}
      zoom={zoom}
      readerPageState={readerPageState}
      requestedPage={requestedPage}
      focusedAnnotationId={focusedAnnotationId}
      sidePanelOpen={sidePanelOpen}
      sidePanelTab={sidePanelTab}
      sidePanels={sidePanels}
      aiThreadContexts={aiThreadContexts}
      noteDraftPatch={noteDraftPatch}
      onLayoutChange={onLayoutChange}
      onContentModeChange={onContentModeChange}
      onFileModeChange={onFileModeChange}
      onTranslatedFileIdChange={onTranslatedFileIdChange}
      onActiveParallelFileKindChange={onActiveParallelFileKindChange}
      onParallelSyncLockedChange={onParallelSyncLockedChange}
      onSelectAnnotationTool={onSelectAnnotationTool}
      onSelectAnnotationColor={onSelectAnnotationColor}
      onCustomAnnotationColorChange={onCustomAnnotationColorChange}
      onZoomChange={onZoomChange}
      onFitWidth={onFitWidth}
      onSidePanelOpenChange={onSidePanelOpenChange}
      onSidePanelTabChange={onSidePanelTabChange}
      onJumpToPage={onJumpToPage}
      onReaderStateChange={onReaderStateChange}
      onFocusAnnotation={onFocusAnnotation}
      onNoteDraftPatchConsumed={onNoteDraftPatchConsumed}
      onAppendAnnotationToNote={onAppendAnnotationToNote}
      onNoteSave={onNoteSave}
      onCreateNote={onCreateNote}
      onCreateAnnotation={onCreateAnnotation}
      onUpdateAnnotationComment={onUpdateAnnotationComment}
      onUpdateAnnotationColor={onUpdateAnnotationColor}
      onUpdateAnnotationPosition={onUpdateAnnotationPosition}
      onDeleteAnnotation={onDeleteAnnotation}
    >
      <section className="scene active reader-scene-shell">
        <div className={sidePanelOpen ? 'reader-workspace-shell workspace-open' : 'reader-workspace-shell'} style={readerLayoutStyle}>
          <div className="reader-main-workspace">
            <ReaderToolbar
              paper={paper}
              fileMode={fileMode}
              currentTranslatedFileId={currentTranslatedFileId}
              parallelSyncLocked={parallelSyncLocked}
              activeAnnotationTool={activeAnnotationTool}
              activeAnnotationColor={activeAnnotationColor}
              customAnnotationColor={customAnnotationColor}
              toolSettings={toolSettings}
              zoom={zoom}
              readerPageState={readerPageState}
              sidePanelOpen={sidePanelOpen}
              onFileModeChange={onFileModeChange}
              onTranslatedFileIdChange={onTranslatedFileIdChange}
              onParallelSyncLockedChange={onParallelSyncLockedChange}
              onSelectAnnotationTool={onSelectAnnotationTool}
              onSelectAnnotationColor={onSelectAnnotationColor}
              onCustomAnnotationColorChange={onCustomAnnotationColorChange}
              onToolSettingsChange={setToolSettings}
              onZoomChange={onZoomChange}
              onFitWidth={onFitWidth}
              onJumpToPage={onJumpToPage}
              onSidePanelOpenChange={onSidePanelOpenChange}
            />
            <div className="reader-layout">
              <ReaderDocumentPane
                paper={paper}
                contentMode={contentMode}
                fileMode={fileMode}
                currentTranslatedFileId={currentTranslatedFileId}
                activeParallelFileKind={activeParallelFileKind}
                parallelSyncLocked={parallelSyncLocked}
                activeAnnotationTool={activeAnnotationTool}
                zoom={zoom}
                activeAnnotationColor={activeAnnotationColor}
                toolSettings={toolSettings}
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
                onActiveParallelFileKindChange={onActiveParallelFileKindChange}
                onNavigateAnnotation={navigateAnnotationId}
              />
            </div>
          </div>
          <ReaderSideDrawer
            open={sidePanelOpen}
            width={sidePanelWidth}
            onWidthChange={setSidePanelWidth}
            sidePanels={sidePanels}
            sidePanelTab={sidePanelTab}
            paper={paper}
            fileMode={activeFileKind}
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
            onNavigateAnnotation={navigateAnnotationId}
            onNavigateRelationTarget={navigateRelationTarget}
          />
        </div>
      </section>
    </ReaderProvider>
  );
}

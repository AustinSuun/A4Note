import { ReaderSaveErrorNotice } from './ReaderSaveErrorNotice';
import { ReaderPageControl } from './ReaderPageControl';
import { ReaderNoteActivity, ReaderNoteRequests } from './ReaderNoteActivity';
import { BookOpenText, ChevronLeft } from 'lucide-react';
import { useReaderLayoutPosition } from './useReaderLayoutPosition';
import { useReaderWritingShortcuts } from './useReaderWritingShortcuts';
import { useReaderDrawerLayout } from './useReaderDrawerLayout';
import './reader-writing-layout.css';
import { useEffect, useState, type CSSProperties } from 'react';
import type { AnnotationColor, PaperDocument, PositionJson } from '../../core/types';
import type { ObjectNavigationTarget } from '../../core/relations';
import { ReaderDocumentPane } from './ReaderDocumentPane';
import { ReaderProvider } from './ReaderContext';
import { ReaderSideDrawer } from './ReaderSideDrawer';
import { ReaderToolbar } from './ReaderToolbar';
import { preferredTranslatedFileId } from './readerHelpers';
import { type ReaderSceneProps, type ReaderToolSettings } from './types';
import { loadReaderToolSettings, saveReaderToolSettings } from './pdf/readerToolSettingsStorage';

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
  panelViews = [],
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
  const drawer = useReaderDrawerLayout();
  const writingExpanded = drawer.expanded && sidePanelOpen && sidePanelTab === 'notes';
  const overlay = sidePanelOpen && drawer.compact;
  const mainHidden = writingExpanded || overlay;
  useReaderLayoutPosition(drawer.containerRef,
    JSON.stringify([paper.paperId, contentMode, fileMode, currentTranslatedFileId, requestedPage, focusedAnnotationId, zoom]),
    JSON.stringify([sidePanelOpen, drawer.width, writingExpanded, overlay]));
  const openNotes = () => { onSidePanelTabChange('notes'); onSidePanelOpenChange(true); };
  const toggleNotes = () => { if (sidePanelOpen && sidePanelTab === 'notes') onSidePanelOpenChange(false); else openNotes(); };
  const toggleWriting = () => { if (!sidePanelOpen || sidePanelTab !== 'notes') { openNotes(); drawer.setExpanded(true); } else if (!drawer.compact) drawer.setExpanded(!drawer.expanded); };
  useReaderWritingShortcuts(drawer.containerRef, toggleNotes, toggleWriting);
  const [toolSettings, setToolSettings] = useState<ReaderToolSettings>(() => loadReaderToolSettings());
  useEffect(() => { saveReaderToolSettings(toolSettings); }, [toolSettings]);
  const focusedAnnotation = paper.annotations.find((annotation) => annotation.id === focusedAnnotationId) ?? null;
  const focusedEditableAnnotation = focusedAnnotation && isEditableToolbarAnnotation(focusedAnnotation)
    ? focusedAnnotation
    : null;
  const contextAnnotation = activeAnnotationTool === 'cursor' ? focusedEditableAnnotation : null;
  const contextToolSettings = contextAnnotation ? settingsFromAnnotation(contextAnnotation, toolSettings) : null;
  const readerLayoutStyle = sidePanelOpen
    ? ({ '--reader-side-width': `${drawer.width}px` } as CSSProperties)
    : undefined;

  useEffect(() => {
    if (focusedEditableAnnotation && activeAnnotationTool !== 'cursor') {
      onSelectAnnotationTool('cursor');
    }
  }, [activeAnnotationTool, focusedEditableAnnotation?.id, onSelectAnnotationTool]);

  const updateContextAnnotationSettings = (annotationId: string, settings: ReaderToolSettings) => {
    const annotation = paper.annotations.find((item) => item.id === annotationId);
    if (!annotation || !isEditableToolbarAnnotation(annotation)) return;
    void onUpdateAnnotationPosition(annotation.id, positionFromSettings(annotation, settings));
  };

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
    if (target.kind === 'note') { onContentModeChange('pdf'); onSidePanelTabChange('notes'); return; }
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
      <section className="scene active reader-scene-shell" data-reader-layer="root">
        <div ref={drawer.containerRef} className={`reader-workspace-shell ${sidePanelOpen ? 'workspace-open' : ''} ${writingExpanded ? 'writing-expanded' : ''} ${overlay ? 'drawer-overlay' : ''}`} style={readerLayoutStyle}
          onKeyDown={event => {
            if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && writingExpanded && !drawer.compact && !(event.target as HTMLElement).closest('[role="dialog"], dialog')) {
              event.preventDefault(); drawer.setExpanded(false);
            }
          }}>
          {!sidePanelOpen && <button type="button" className="reader-note-reopen" aria-label="继续笔记，展开笔记侧栏" aria-expanded={false} aria-keyshortcuts="Control+Alt+N" title="继续笔记（Ctrl+Alt+N）" onClick={openNotes}>
            <BookOpenText size={15} aria-hidden="true" />
            <span className="reader-note-reopen-label">继续笔记</span>
            <ChevronLeft size={12} className="reader-note-reopen-chevron" aria-hidden="true" />
          </button>}
          <ReaderSaveErrorNotice paperId={paper.paperId} />
          <ReaderNoteActivity.Provider value={!mainHidden}><ReaderNoteRequests.Provider value={!(sidePanelOpen && sidePanelTab === 'notes')}>
          <div className="reader-main-workspace" inert={mainHidden} aria-hidden={mainHidden}>
        <ReaderToolbar
              paper={paper}
              contentMode={contentMode}
              fileMode={fileMode}
              currentTranslatedFileId={currentTranslatedFileId}
              parallelSyncLocked={parallelSyncLocked}
              activeAnnotationTool={activeAnnotationTool}
              activeAnnotationColor={activeAnnotationColor}
              customAnnotationColor={customAnnotationColor}
              toolSettings={toolSettings}
              contextAnnotationId={contextAnnotation?.id ?? null}
              contextAnnotationTool={contextAnnotation?.type ?? null}
              contextAnnotationColor={(contextAnnotation?.color as AnnotationColor | undefined) ?? null}
              contextToolSettings={contextToolSettings}
              zoom={zoom}
              onFileModeChange={onFileModeChange}
              onContentModeChange={onContentModeChange}
              onTranslatedFileIdChange={onTranslatedFileIdChange}
              onParallelSyncLockedChange={onParallelSyncLockedChange}
              onSelectAnnotationTool={onSelectAnnotationTool}
              onSelectAnnotationColor={onSelectAnnotationColor}
              onCustomAnnotationColorChange={onCustomAnnotationColorChange}
              onToolSettingsChange={setToolSettings}
              onUpdateContextAnnotationColor={(annotationId, color) => void onUpdateAnnotationColor(annotationId, color)}
              onUpdateContextAnnotationSettings={updateContextAnnotationSettings}
              onClearContextAnnotation={() => onFocusAnnotation(null)}
              onZoomChange={onZoomChange}
              onFitWidth={onFitWidth}
            />
            <div className="reader-layout">
              {contentMode === 'pdf' && <ReaderPageControl paperId={paper.paperId} readerPageState={readerPageState} onJumpToPage={onJumpToPage} />}
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
                onCompleteOneShotTool={() => onSelectAnnotationTool('cursor')}
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
                noteDraftPatch={noteDraftPatch}
                onNoteDraftPatchConsumed={onNoteDraftPatchConsumed}
                onNoteSave={onNoteSave}
                onActiveParallelFileKindChange={onActiveParallelFileKindChange}
                onNavigateAnnotation={navigateAnnotationId}
              />
            </div>
          </div>
          </ReaderNoteRequests.Provider></ReaderNoteActivity.Provider>
          <ReaderSideDrawer
            open={sidePanelOpen}
            width={drawer.width}
            maximumWidth={drawer.maximum}
            expanded={writingExpanded}
            compact={drawer.compact}
            onExpandedChange={drawer.setExpanded}
            onWidthChange={drawer.changeWidth}
            sidePanels={sidePanels}
            panelViews={panelViews}
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
            onCreateNote={onCreateNote}
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

type EditableToolbarAnnotation = PaperDocument['annotations'][number] & { type: 'text' | 'rect' | 'arrow' };

function isEditableToolbarAnnotation(annotation: PaperDocument['annotations'][number]): annotation is EditableToolbarAnnotation {
  return annotation.type === 'text' || annotation.type === 'rect' || annotation.type === 'arrow';
}

function settingsFromAnnotation(annotation: EditableToolbarAnnotation, fallback: ReaderToolSettings): ReaderToolSettings {
  const position = annotation.positionJson;
  if (annotation.type === 'text') {
    return {
      ...fallback,
      textBold: Boolean(position.bold),
      textItalic: Boolean(position.italic),
      textFontSize: positionNumber(position, 'fontSize', fallback.textFontSize),
      textColor: positionString(position, 'textColor', fallback.textColor),
      textBorderColor: positionString(position, 'borderColor', fallback.textBorderColor),
      textBackgroundColor: positionString(position, 'backgroundColor', fallback.textBackgroundColor),
    };
  }
  if (annotation.type === 'rect') {
    return {
      ...fallback,
      shapeKind: position.shapeKind === 'ellipse' ? 'ellipse' : 'rect',
      shapeFillEnabled: Boolean(position.fillEnabled),
      shapeStrokeWidth: positionNumber(position, 'strokeWidth', fallback.shapeStrokeWidth),
    };
  }
  return {
    ...fallback,
    arrowStyle: position.arrowStyle === 'dashed' || position.arrowStyle === 'double' ? position.arrowStyle : 'solid',
    arrowEnding: position.arrowEnding === 'line' ? 'line' : 'arrow',
    arrowStrokeWidth: positionNumber(position, 'strokeWidth', fallback.arrowStrokeWidth),
  };
}

function positionFromSettings(annotation: EditableToolbarAnnotation, settings: ReaderToolSettings): PositionJson {
  if (annotation.type === 'text') {
    return {
      ...annotation.positionJson,
      bold: settings.textBold,
      italic: settings.textItalic,
      fontSize: settings.textFontSize,
      textColor: settings.textColor,
      borderColor: settings.textBorderColor,
      backgroundColor: settings.textBackgroundColor,
    };
  }
  if (annotation.type === 'rect') {
    return {
      ...annotation.positionJson,
      shapeKind: settings.shapeKind,
      fillEnabled: settings.shapeFillEnabled,
      strokeWidth: settings.shapeStrokeWidth,
    };
  }
  return {
    ...annotation.positionJson,
    arrowStyle: settings.arrowStyle,
    arrowEnding: settings.arrowEnding,
    strokeWidth: settings.arrowStrokeWidth,
  };
}

function positionNumber(position: PositionJson, key: string, fallback: number) {
  const value = position[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positionString(position: PositionJson, key: string, fallback: string) {
  return typeof position[key] === 'string' ? position[key] : fallback;
}

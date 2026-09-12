import { useEffect, useState, type CSSProperties } from 'react';
import type { AnnotationColor, PaperDocument, PositionJson } from '../../core/types';
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
  const [sidePanelWidth, setSidePanelWidth] = useState(360);
  const [toolSettings, setToolSettings] = useState<ReaderToolSettings>(defaultReaderToolSettings);
  const focusedAnnotation = paper.annotations.find((annotation) => annotation.id === focusedAnnotationId) ?? null;
  const focusedEditableAnnotation = focusedAnnotation && isEditableToolbarAnnotation(focusedAnnotation)
    ? focusedAnnotation
    : null;
  const contextAnnotation = activeAnnotationTool === 'cursor' ? focusedEditableAnnotation : null;
  const contextToolSettings = contextAnnotation ? settingsFromAnnotation(contextAnnotation, toolSettings) : null;
  const readerLayoutStyle = sidePanelOpen
    ? ({ '--reader-side-width': `${sidePanelWidth}px` } as CSSProperties)
    : undefined;

  const clampSidePanelWidth = (requestedWidth: number, availableWidth = document.querySelector<HTMLElement>('.workbench-surface')?.clientWidth ?? window.innerWidth) => {
    // Keep enough room for the document pane and its toolbar when the drawer
    // is resized, especially after the workbench sidebar is collapsed.
    const minimumMainWidth = 520;
    const maximumForLayout = availableWidth - minimumMainWidth - 12;
    const maximumWidth = Math.min(640, Math.max(300, maximumForLayout));
    return Math.max(300, Math.min(maximumWidth, requestedWidth));
  };

  const handleSidePanelWidthChange = (requestedWidth: number) => {
    setSidePanelWidth(clampSidePanelWidth(requestedWidth));
  };

  useEffect(() => {
    const element = document.querySelector<HTMLElement>('.workbench-surface');
    if (!element) return undefined;
    const clampToContainer = () => {
      setSidePanelWidth((current) => {
        const next = clampSidePanelWidth(current, element.clientWidth);
        return next === current ? current : next;
      });
    };
    clampToContainer();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(clampToContainer);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);

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
        <div className={sidePanelOpen ? 'reader-workspace-shell workspace-open' : 'reader-workspace-shell'} style={readerLayoutStyle}>
          <div className="reader-main-workspace">
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
              readerPageState={readerPageState}
              sidePanelOpen={sidePanelOpen}
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
          <ReaderSideDrawer
            open={sidePanelOpen}
            width={sidePanelWidth}
            onWidthChange={handleSidePanelWidthChange}
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

import { ReaderSaveErrorNotice } from './ReaderSaveErrorNotice';
import { ReaderPageControl } from './ReaderPageControl';
import { ReaderNoteActivity, ReaderNoteRequests, ReaderNoteCreateAction, type ReaderNoteCreateBridge } from './ReaderNoteActivity';
import { BookOpenText, ChevronLeft } from 'lucide-react';
import { useReaderLayoutPosition } from './useReaderLayoutPosition';
import { useReaderWritingShortcuts } from './useReaderWritingShortcuts';
import { ReaderNoteWorkbenchMenu } from './ReaderNoteWorkbenchMenu';
import { NOTE_WORKBENCH_COMMANDS, modeForNoteWorkbenchCommand, splitWidthPx, type NoteWorkbenchMode } from './noteWorkbench';
import { useNoteWorkbench } from './useNoteWorkbench';
import { useNotePanelPresence } from './useNotePanelPresence';
import { floatingPopOrigin } from './noteEnterMotion';
import { ReaderNoteFloatingControls } from './ReaderNoteFloatingControls';
import { useNoteLayoutFlip } from './useNoteLayoutFlip';
import { useReaderDrawerLayout } from './useReaderDrawerLayout';
import './reader-writing-layout.css';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
  const noteCreate = useRef<ReaderNoteCreateBridge>({ pending: false });
  const workbench = useNoteWorkbench(paper.paperId, drawer.available);
  const notesVisible = sidePanelOpen && sidePanelTab === 'notes';
  const visibleNoteMode = notesVisible ? workbench.mode : 'reading';
  const notePanelVisible = notesVisible && visibleNoteMode !== 'reading';
  const notePresence = useNotePanelPresence(notePanelVisible, visibleNoteMode);
  const notePanelPresented = notePanelVisible || notePresence.phase !== 'hidden';
  const notePresentationMode = notePanelVisible ? visibleNoteMode : notePanelPresented ? notePresence.mode : 'reading';
  const writingExpanded = notePanelVisible && visibleNoteMode === 'writing';
  const overlay = sidePanelOpen && drawer.compact && visibleNoteMode !== 'floating';
  const mainHidden = writingExpanded || overlay;
  useReaderLayoutPosition(drawer.containerRef,
    JSON.stringify([paper.paperId, contentMode, fileMode, currentTranslatedFileId, requestedPage, focusedAnnotationId, zoom]),
    JSON.stringify([sidePanelOpen, drawer.width, writingExpanded, overlay]));
  const openNotes = () => { onSidePanelTabChange('notes'); onSidePanelOpenChange(true); };
  const toggleNotes = () => { if (sidePanelOpen && sidePanelTab === 'notes') onSidePanelOpenChange(false); else openNotes(); };
  const toggleWriting = () => { if (!sidePanelOpen || sidePanelTab !== 'notes') { openNotes(); drawer.setExpanded(true); } else if (!drawer.compact) drawer.setExpanded(!drawer.expanded); };
  /* One command path for the entry button, the menu, Escape and the shortcut listener;
     the registry (src/core/shortcuts.ts on the shortcuts branch) registers NOTE_WORKBENCH_COMMAND_LIST
     and calls this same dispatcher, so no second key listener is added here. */
  const applyNoteMode = (mode: NoteWorkbenchMode) => {
    if (mode === 'reading') {
      if (sidePanelOpen && sidePanelTab === 'notes') onSidePanelOpenChange(false);
    } else openNotes();
    workbench.setMode(mode);
  };
  /* Escape leaves the wide mode and returns to the anchor the reader came from. */
  const exitNoteMode = () => workbench.restoreMode();
  const runWorkbenchCommand = (command: string) => {
    const mode = modeForNoteWorkbenchCommand(command);
    if (mode) { applyNoteMode(mode); return; }
    if (command === NOTE_WORKBENCH_COMMANDS.toggle) applyNoteMode(visibleNoteMode === 'reading' ? workbench.prefs.wideMode : 'reading');
  };
  useReaderWritingShortcuts(drawer.containerRef, runWorkbenchCommand);
  useEffect(() => {
    if (workbench.mode === 'reading') {
      if (sidePanelOpen && sidePanelTab === 'notes') onSidePanelOpenChange(false);
      return;
    }
    if (sidePanelTab !== 'notes') onSidePanelTabChange('notes');
    if (!sidePanelOpen) onSidePanelOpenChange(true);
  }, [workbench.mode]);
  useEffect(() => {
    if (drawer.compact) return;
    drawer.setExpanded(workbench.mode === 'writing');
  }, [workbench.mode, drawer.compact]);
  useEffect(() => {
    if (workbench.mode !== 'split') return;
    drawer.changeWidth(splitWidthPx(drawer.available, workbench.prefs.splitRatio));
  }, [workbench.mode, workbench.prefs.splitRatio, drawer.available]);
  const resizeMaximum = visibleNoteMode === 'split' ? splitWidthPx(drawer.available, 1) : drawer.maximum;
  const floatingActive = notePanelVisible && visibleNoteMode === 'floating';
  const floatingPresented = notePanelPresented && notePresentationMode === 'floating';
  const floatingRect = workbench.prefs.floating;
  const floatingStyle = floatingPresented ? ({
    '--floating-note-left': `${floatingRect.x * 100}%`,
    '--floating-note-top': `${floatingRect.y * 100}%`,
    '--floating-note-width': `${floatingRect.width * 100}%`,
    '--floating-note-height': `${floatingRect.height * 100}%`,
    '--note-pop-origin': floatingPopOrigin(floatingRect),
  } as CSSProperties) : undefined;
  /* A mode switch while the panel is visible travels between the two boxes (FLIP) instead of
     fading out and re-entering; the key covers every geometry change that is not a mode change. */
  useNoteLayoutFlip(drawer.containerRef, notePresentationMode, notePanelPresented,
    JSON.stringify([drawer.width, drawer.available, drawer.expanded, floatingRect, notePresence.phase, overlay]));
  const [toolSettings, setToolSettings] = useState<ReaderToolSettings>(() => loadReaderToolSettings());
  useEffect(() => { saveReaderToolSettings(toolSettings); }, [toolSettings]);
  const focusedAnnotation = paper.annotations.find((annotation) => annotation.id === focusedAnnotationId) ?? null;
  const focusedEditableAnnotation = focusedAnnotation && isEditableToolbarAnnotation(focusedAnnotation)
    ? focusedAnnotation
    : null;
  const contextAnnotation = activeAnnotationTool === 'cursor' ? focusedEditableAnnotation : null;
  const contextToolSettings = contextAnnotation ? settingsFromAnnotation(contextAnnotation, toolSettings) : null;
  /* The docked column slides through its grid track: the track is 0 while the note panel is
     hidden/entering/exiting and the target width once entered, while the drawer itself keeps
     --reader-side-target (reader-writing-layout.css), so the PDF column gives way
     continuously instead of jumping. */
  const noteTrackOpen = notePresentationMode !== 'split' || notePresence.phase === 'entered';
  const readerLayoutStyle = sidePanelOpen || notePanelPresented
    ? ({ '--reader-side-width': `${noteTrackOpen ? drawer.width : 0}px`, '--reader-side-target': `${drawer.width}px` } as CSSProperties)
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
        <div ref={drawer.containerRef} className={`reader-workspace-shell note-mode-${notePresentationMode} ${sidePanelOpen || notePanelPresented ? 'workspace-open' : ''} ${writingExpanded ? 'writing-expanded' : ''} ${overlay ? 'drawer-overlay' : ''}`}
          data-note-mode={visibleNoteMode} data-note-motion-mode={notePresentationMode} data-note-presence={notePresence.phase}
          data-note-requested-mode={workbench.requestedMode} data-note-temporary={workbench.temporary ? 'true' : 'false'} style={{ ...readerLayoutStyle, ...floatingStyle }}
          onKeyDown={event => {
            if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && writingExpanded && !drawer.compact && !(event.target as HTMLElement).closest('[role="dialog"], dialog')) {
              event.preventDefault(); exitNoteMode();
            }
          }}>
            <ReaderNoteWorkbenchMenu
              mode={visibleNoteMode}
              temporary={notesVisible && workbench.temporary}
              onToggle={() => visibleNoteMode === 'writing' ? exitNoteMode() : runWorkbenchCommand(NOTE_WORKBENCH_COMMANDS.toggle)}
              onSelectMode={applyNoteMode}
              onNewNote={() => { if (noteCreate.current.create) noteCreate.current.create(); else noteCreate.current.pending = true; applyNoteMode(visibleNoteMode === 'reading' ? workbench.prefs.wideMode : visibleNoteMode); }}
              docked={(sidePanelOpen || notePanelPresented) && !floatingPresented && !writingExpanded && notePresentationMode !== 'writing'}
              overlay={overlay}
              drawerWidth={drawer.width}
              resize={sidePanelOpen && !floatingActive && !writingExpanded && !overlay ? { width: drawer.width, maximum: resizeMaximum, onChange: next => { drawer.changeWidth(next); workbench.setSplitRatio(next / Math.max(1, drawer.available)); } } : undefined}
            />
          {floatingPresented && (
            <ReaderNoteFloatingControls active={floatingActive} rect={floatingRect} containerRef={drawer.containerRef}
              onRectChange={workbench.setFloatingRect} onEscape={() => applyNoteMode('split')} />
          )}

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
          <ReaderNoteCreateAction.Provider value={noteCreate.current}><ReaderSideDrawer
            open={sidePanelOpen}
            noteActive={notePanelVisible}
            notePresence={notePresence.phase}
            noteMode={workbench.mode}
            onSelectNoteMode={applyNoteMode}
            width={drawer.width}
            maximumWidth={resizeMaximum}
            expanded={writingExpanded}
            compact={drawer.compact}
            onExpandedChange={drawer.setExpanded}
            onWidthChange={(next) => {
              drawer.changeWidth(next);
              workbench.setSplitRatio(next / Math.max(1, drawer.available));
            }}
            sidePanels={sidePanels}
            panelViews={panelViews}
            sidePanelTab={sidePanelTab}
            paper={paper}
            fileMode={activeFileKind}
            translatedFileId={currentTranslatedFileId}
            aiThreadContexts={aiThreadContexts}
            focusedAnnotationId={focusedAnnotationId}
            noteDraftPatch={noteDraftPatch}
            onSidePanelOpenChange={open => { onSidePanelOpenChange(open); if (!open && sidePanelTab === 'notes') workbench.setMode('reading'); }}
            onSidePanelTabChange={tab => { onSidePanelTabChange(tab); if (tab === 'notes' && workbench.mode === 'reading') workbench.setMode(workbench.prefs.wideMode); }}
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
          /></ReaderNoteCreateAction.Provider>
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

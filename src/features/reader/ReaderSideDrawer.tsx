import { ReaderNoteModeSwitch } from './ReaderNoteWorkbenchMenu';
import type { NoteWorkbenchMode } from './noteWorkbench';
import { RetainedReaderNote, ReaderNoteLayoutActions } from './ReaderNoteActivity';
import { ReaderDrawerResizer } from './ReaderDrawerResizer';
import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { ObjectNavigationTarget } from '../../core/relations';
import type { AnnotationColor, AiThreadContext, PaperDocument, PositionJson, ReaderSidePanelTab } from '../../core/types';
import type { PaperFileKind } from '../../platform/nativeApi';
import type { WorkbenchPanelViewContribution } from '../../workbench';
import { zh } from '../../ui/zh';
import { SidebarIcon } from './ReaderIcons';
import type { NoteDraftPatch, NoteSaveInput, ReaderSidePanelDefinition } from './types';

// Order matches the workbench panel contributions; annotations belongs here so the list
// is reachable by the user, not only through programmatic setReaderSidePanelTab calls.
const workspacePanelTabs: ReaderSidePanelTab[] = ['notes', 'annotations', 'chat', 'cite'];

export function ReaderSideDrawer({
  open,
  noteMode,
  onSelectNoteMode,
  width,
  maximumWidth,
  expanded,
  compact,
  onExpandedChange,
  onWidthChange,
  sidePanels,
  panelViews,
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
  open: boolean;
  noteMode?: NoteWorkbenchMode;
  onSelectNoteMode?: (mode: NoteWorkbenchMode) => void;
  width: number;
  maximumWidth: number;
  expanded: boolean;
  compact: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onWidthChange: (width: number) => void;
  sidePanels: ReaderSidePanelDefinition[];
  panelViews: WorkbenchPanelViewContribution[];
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
  const [openTabs, setOpenTabs] = useState<ReaderSidePanelTab[]>([sidePanelTab]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [retainedPaper, setRetainedPaper] = useState<string | null>(open && sidePanelTab === 'notes' ? paper.paperId : null);

  const panelById = useMemo(() => {
    return new Map(sidePanels.map((panel) => [panel.id, panel] as const));
  }, [sidePanels]);

  const addablePanels = workspacePanelTabs
    .map((tab) => panelById.get(tab))
    .filter((panel): panel is ReaderSidePanelDefinition => Boolean(panel));
  const activePanel = panelById.get(sidePanelTab);
  const activePanelView = activePanel ? panelViews.find((view) => view.id === activePanel.panel.id) : undefined;

  useEffect(() => {
    setOpenTabs((current) => (current.includes(sidePanelTab) ? current : [...current, sidePanelTab]));
  }, [sidePanelTab]);

  const notesPanel = panelById.get('notes');
  const notesView = notesPanel ? panelViews.find(view => view.id === notesPanel.panel.id) : undefined;
  const notesActive = open && sidePanelTab === 'notes';
  const retainNotes = notesActive || retainedPaper === paper.paperId;
  useEffect(() => { if (notesActive) setRetainedPaper(paper.paperId); }, [notesActive, paper.paperId]);
  useEffect(() => { if (!open) setAddMenuOpen(false); }, [open]);
  if (!open && !retainNotes) return null;

  const openWorkspaceTab = (tab: ReaderSidePanelTab) => {
    setOpenTabs((current) => (current.includes(tab) ? current : [...current, tab]));
    onSidePanelTabChange(tab);
    setAddMenuOpen(false);
  };

  const closeTab = (tab: ReaderSidePanelTab, event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (tab === 'notes') setRetainedPaper(null);
    setOpenTabs((current) => {
      const tabIndex = current.indexOf(tab);
      const next = current.filter((item) => item !== tab);
      if (!next.length) {
        onSidePanelOpenChange(false);
        return [tab];
      }
      if (sidePanelTab === tab) {
        onSidePanelTabChange(next[Math.max(0, tabIndex - 1)] ?? next[0]);
      }
      return next;
    });
  };

  return (
    <aside
      className={`reader-workspace-drawer${notesActive ? ' notes-active' : ''}`}
      data-reader-layer="sidebar"
      aria-label="阅读工作面板" hidden={!open} inert={!open} aria-hidden={!open}
      style={{ width: expanded || compact ? '100%' : width, display: open ? undefined : 'none' }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onKeyDown={event => { if (event.key === 'Escape' && addMenuOpen && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setAddMenuOpen(false); } }}
    >
      {open && !expanded && !compact && <ReaderDrawerResizer width={width} maximum={maximumWidth} onChange={onWidthChange} />}
      {!notesActive && <header className="reader-workspace-header">
        <div className="reader-workspace-tabs" role="tablist" aria-label={zh.reader.openPanel}>
          {openTabs.map((tab) => {
            const panel = panelById.get(tab);
            const active = sidePanelTab === tab;
            return (
              <div key={tab} className={`reader-workspace-tab ${active ? 'active' : ''}`.trim()}>
                <button
                  className="reader-workspace-tab-main"
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSidePanelTabChange(tab)}
                  title={panel?.commandTitle ?? readerWorkspaceFallbackTitle(tab)}
                >
                  {panel?.label ?? readerWorkspaceFallbackLabel(tab)}
                </button>
                <button
                  className="reader-workspace-tab-close"
                  type="button"
                  aria-label={`${zh.reader.closePanel} ${panel?.label ?? readerWorkspaceFallbackLabel(tab)}`}
                  onClick={(event) => closeTab(tab, event)}
                >
                  ×
                </button>
              </div>
            );
          })}
          <div className="reader-workspace-add-shell">
            <button className="reader-workspace-add" type="button" onClick={() => setAddMenuOpen((current) => !current)} title="打开面板">
              +
            </button>
            {addMenuOpen && (
              <div className="reader-workspace-add-menu">
                {addablePanels.map((panel) => (
                  <button key={panel.id} type="button" onClick={() => openWorkspaceTab(panel.id)}>
                    {panel.icon()}
                    <span>{panel.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="reader-workspace-actions">

          
          <button
            className="reader-workspace-toggle active"
            type="button"
            onClick={() => onSidePanelOpenChange(false)}
            title="收起面板，保留笔记编辑状态（Ctrl+Alt+N）"
            aria-label={zh.reader.closePanel}
            aria-pressed="true"
          >
            <SidebarIcon />
          </button>
        </div>
      </header>}

      <div className="workspace-panel-content">
        {retainNotes && notesPanel && notesView && <RetainedReaderNote key={paper.paperId} active={notesActive}>
          <ReaderNoteLayoutActions.Provider value={noteMode && onSelectNoteMode ? <ReaderNoteModeSwitch mode={noteMode} onSelectMode={onSelectNoteMode} /> : null}>
          {notesView.render({ panel: notesPanel.panel, sceneId: 'reader', selectedPaper: paper })}
                  </ReaderNoteLayoutActions.Provider>
        </RetainedReaderNote>}
        {open && sidePanelTab !== 'notes' && activePanel && activePanelView
          ? activePanelView.render({ panel: activePanel.panel, sceneId: 'reader', selectedPaper: paper })
          : null}
      </div>
    </aside>
  );
}

function readerWorkspaceFallbackLabel(tab: ReaderSidePanelTab) {
  const labels: Record<ReaderSidePanelTab, string> = {
    notes: zh.reader.panelNotes,
    chat: zh.reader.panelChat,
    cite: '引用',
    annotations: zh.reader.panelAnnotations,
    relations: zh.reader.panelRelations,
  };
  return labels[tab];
}

function readerWorkspaceFallbackTitle(tab: ReaderSidePanelTab) {
  return `打开${readerWorkspaceFallbackLabel(tab)}`;
}

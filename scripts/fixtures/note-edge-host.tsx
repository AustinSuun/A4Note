import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/ui/styles/tokens.css';
import '/src/ui/styles/reader.css';
import '/src/features/reader/reader-writing-layout.css';
import { ReaderNoteWorkbenchMenu, ReaderNoteModeSwitch } from '/src/features/reader/ReaderNoteWorkbenchMenu';
import { ReaderNoteFloatingControls } from '/src/features/reader/ReaderNoteFloatingControls';
import { useReaderDrawerLayout } from '/src/features/reader/useReaderDrawerLayout';
import { ReaderDrawerResizer } from '/src/features/reader/ReaderDrawerResizer';
import { useNoteWorkbench } from '/src/features/reader/useNoteWorkbench';
import { useNotePanelPresence } from '/src/features/reader/useNotePanelPresence';
import { NOTE_WORKBENCH_COMMANDS, floatingCardBox, modeForNoteWorkbenchCommand, splitWidthPx } from '/src/features/reader/noteWorkbench';

/* Host mirrors ReaderScene's workbench wiring (shell classes, drawer, retained note,
   floating controls) while reusing the real state hook, menu, geometry and CSS. */
const NOTES = { 'paper-a': ['note-a1', 'note-a2'], 'paper-b': ['note-b1'], 'paper-c': [] };

function Host() {
  const [paperId, setPaperId] = useState('paper-a');
  const [containerWidth, setContainerWidth] = useState(1440);
  const { containerRef } = useReaderDrawerLayout();
  const workbench = useNoteWorkbench(paperId, containerWidth);
  const [draft, setDraft] = useState('论文笔记草稿');
  const [historyOpen, setHistoryOpen] = useState(false);
  const mode = workbench.mode;
  const drawerOpen = mode !== 'reading';
  const notePresence = useNotePanelPresence(drawerOpen, mode);
  const drawerPresented = drawerOpen || notePresence.phase !== 'hidden';
  const presentationMode = drawerOpen ? mode : drawerPresented ? notePresence.mode : 'reading';
  const writingExpanded = mode === 'writing';
  const drawerWidth = splitWidthPx(containerWidth, workbench.prefs.splitRatio);
  const floatingRect = workbench.prefs.floating;
  const floatingBox = floatingCardBox(floatingRect, containerWidth, 620);
  const floatingStyle = presentationMode === 'floating' && drawerPresented ? {
    '--floating-note-left': floatingRect.x * 100 + '%',
    '--floating-note-top': floatingRect.y * 100 + '%',
    '--floating-note-width': floatingRect.width * 100 + '%',
    '--floating-note-height': floatingRect.height * 100 + '%',
  } : {};
  const activeNoteId = workbench.prefs.activeNoteId;

  const runCommand = (command) => {
    const next = modeForNoteWorkbenchCommand(command);
    if (next) { workbench.setMode(next); return; }
    if (command === NOTE_WORKBENCH_COMMANDS.toggle) workbench.setMode(mode === 'reading' ? workbench.prefs.lastOpenMode : 'reading');
  };

  useEffect(() => {
    const presenceLog = window.__presenceLog || [];
    if (presenceLog.at(-1) !== notePresence.phase) window.__presenceLog = [...presenceLog, notePresence.phase];
    window.__edgeTest = { setMode:workbench.setMode, setWidth:setContainerWidth, setFloating:workbench.setFloatingRect };
    window.__wbState = {
      paperId, containerWidth, mode, requested: workbench.requestedMode, temporary: workbench.temporary,
      drawerDiag: (() => { const el = document.querySelector('.reader-workspace-drawer'); if (!el) return null; const style = getComputedStyle(el); return { width: style.width, position: style.position, top: style.top, left: style.left, maxWidth: style.maxWidth }; })(),
      prefs: workbench.prefs, drawerWidth, drawerOpen, drawerPresented, presence: notePresence.phase, floatingBox, activeNoteId,
      storage: Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])),
    };
  });

  return (
    <div className="wb-harness">
      <div className="wb-harness-toolbar">
        <button type="button" className="wb-harness-paper" data-paper="paper-b" onClick={() => setPaperId('paper-b')}>paper-b</button>
        <button type="button" className="wb-harness-paper" data-paper="paper-a" onClick={() => setPaperId('paper-a')}>paper-a</button>
        <button type="button" className="wb-harness-paper" data-paper="paper-c" onClick={() => setPaperId('paper-c')}>paper-c</button>
        <button type="button" className="wb-harness-width" data-width="900" onClick={() => setContainerWidth(900)}>900</button>
        <button type="button" className="wb-harness-width" data-width="1300" onClick={() => setContainerWidth(1300)}>1300</button>
        <button type="button" className="wb-harness-width" data-width="1440" onClick={() => setContainerWidth(1440)}>1440</button>
      </div>
      <div
        ref={containerRef}
        className={'reader-workspace-shell note-mode-' + presentationMode + (drawerPresented ? ' workspace-open' : '') + (writingExpanded ? ' writing-expanded' : '')}
        data-note-mode={mode}
        data-note-motion-mode={presentationMode}
        data-note-presence={notePresence.phase}
        data-note-requested-mode={workbench.requestedMode}
        data-note-temporary={workbench.temporary ? 'true' : 'false'}
        style={{ position: 'relative', width: containerWidth + 'px', height: '620px', '--reader-side-width': drawerWidth+'px', ...floatingStyle }}
        onKeyDown={(event) => { if (event.key === 'Escape' && writingExpanded) workbench.restoreMode(); }}
      >
        <ReaderNoteWorkbenchMenu mode={mode} temporary={workbench.temporary}
          onToggle={() => mode === 'writing' ? workbench.restoreMode() : runCommand(NOTE_WORKBENCH_COMMANDS.toggle)}
          onNewNote={() => { setDraft('');workbench.setMode('split'); }} onSelectMode={workbench.setMode} docked={mode === 'split'} drawerWidth={drawerWidth}
          resize={mode === 'split' ? { width: drawerWidth, maximum: containerWidth - 332, onChange: next => workbench.setSplitRatio(next / containerWidth) } : undefined} />
        <div className="reader-main-workspace" inert={writingExpanded} aria-hidden={writingExpanded}>
          <div className="wb-harness-pdf pdf-document" style={{ width: mode==='split' ? containerWidth - drawerWidth - 12 : containerWidth, overflow:'auto' }}><div style={{height:1800,flex:'0 0 auto'}}>PDF scroll surface</div></div>
        </div>
        {presentationMode === 'floating' && drawerPresented && (
          <ReaderNoteFloatingControls active={drawerOpen} rect={floatingRect} containerRef={containerRef} onRectChange={workbench.setFloatingRect} />
        )}
        {drawerPresented && (
          <aside className="reader-workspace-drawer notes-active" inert={!drawerOpen} aria-hidden={!drawerOpen} data-note-presence={notePresence.phase} style={{ width: presentationMode === 'split' ? drawerWidth + 'px' : undefined }} data-drawer-width={presentationMode === 'split' ? drawerWidth : 'auto'}>
        {mode === 'split' && drawerOpen && (
          <ReaderDrawerResizer width={drawerWidth} maximum={containerWidth - 332} onChange={(next) => workbench.setSplitRatio(next / containerWidth)} />
        )}
            <header className="reader-workspace-header">
              <div className="reader-workspace-tabs" role="tablist" aria-label="面板"><button type="button" className="reader-workspace-tab active" role="tab" aria-selected="true">笔记</button></div>
              <div className="reader-workspace-actions"><ReaderNoteModeSwitch mode={mode} onSelectMode={workbench.setMode} />
                {historyOpen && <span className="note-history-marker">历史</span>}
              </div>
            </header>
            <div className="reader-retained-note">
              <div className="note-workspace"><div className="note-document-actions"><button aria-label="笔记历史" onClick={() => setHistoryOpen(true)}>历史</button></div>
                <textarea className="md-body markdown-live-codemirror" data-note-editor="1" value={draft} onChange={(event) => setDraft(event.target.value)} />
                <div className="note-meta-row"><button type="button" className="wb-harness-note" onClick={() => workbench.setActiveNote((NOTES[paperId] || [])[0] || null)}>选择笔记</button></div>
              </div>
            </div>
          </aside>
        )}

      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Host />);

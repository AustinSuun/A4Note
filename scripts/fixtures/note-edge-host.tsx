import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/ui/styles/tokens.css';
import '/src/ui/styles/reader.css';
import '/src/features/reader/reader-writing-layout.css';
import { ReaderNoteWorkbenchMenu, ReaderNoteModeSwitch } from '/src/features/reader/ReaderNoteWorkbenchMenu';
import { useReaderDrawerLayout } from '/src/features/reader/useReaderDrawerLayout';
import { ReaderDrawerResizer } from '/src/features/reader/ReaderDrawerResizer';
import { useNoteWorkbench } from '/src/features/reader/useNoteWorkbench';
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
  const writingExpanded = mode === 'writing';
  const drawerWidth = splitWidthPx(containerWidth, workbench.prefs.splitRatio);
  const floatingRect = workbench.prefs.floating;
  const floatingBox = floatingCardBox(floatingRect, containerWidth, 620);
  const floatingStyle = mode === 'floating' ? {
    '--floating-note-left': floatingRect.x * 100 + '%',
    '--floating-note-top': floatingRect.y * 100 + '%',
    '--floating-note-width': floatingRect.width * 100 + '%',
    '--floating-note-height': floatingRect.height * 100 + '%',
  } : {};
  const activeNoteId = workbench.prefs.activeNoteId;

  const runCommand = (command) => {
    const next = modeForNoteWorkbenchCommand(command);
    if (next) { workbench.setMode(next); return; }
    if (command === NOTE_WORKBENCH_COMMANDS.toggle) workbench.setMode(mode === 'reading' ? workbench.prefs.wideMode : 'reading');
  };

  const startFloatingDrag = (event) => {
    const rect = containerRef.current.getBoundingClientRect();
    const startX = event.clientX, startY = event.clientY, origin = { ...floatingRect }, element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const move = (moveEvent) => workbench.setFloatingRect({
      ...origin,
      x: Math.min(1 - origin.width, Math.max(0, origin.x + (moveEvent.clientX - startX) / rect.width)),
      y: Math.min(1 - origin.height, Math.max(0, origin.y + (moveEvent.clientY - startY) / rect.height)),
    });
    const stop = () => { element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', stop); };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', stop);
  };
  const startFloatingResize = (event) => {
    const rect = containerRef.current.getBoundingClientRect();
    const startX = event.clientX, startY = event.clientY, origin = { ...floatingRect }, element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const move = (moveEvent) => workbench.setFloatingRect({
      ...origin,
      width: Math.min(1 - origin.x, Math.max(0.24, origin.width + (moveEvent.clientX - startX) / rect.width)),
      height: Math.min(1 - origin.y, Math.max(0.24, origin.height + (moveEvent.clientY - startY) / rect.height)),
    });
    const stop = () => { element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', stop); };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', stop);
  };

  useEffect(() => {
    window.__edgeTest = { setMode:workbench.setMode, setWidth:setContainerWidth, setFloating:workbench.setFloatingRect };
    window.__wbState = {
      paperId, containerWidth, mode, requested: workbench.requestedMode, temporary: workbench.temporary,
      drawerDiag: (() => { const el = document.querySelector('.reader-workspace-drawer'); if (!el) return null; const style = getComputedStyle(el); return { width: style.width, position: style.position, top: style.top, left: style.left, maxWidth: style.maxWidth }; })(),
      prefs: workbench.prefs, drawerWidth, drawerOpen, floatingBox, activeNoteId,
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
        className={'reader-workspace-shell note-mode-' + mode + (drawerOpen ? ' workspace-open' : '') + (writingExpanded ? ' writing-expanded' : '')}
        data-note-mode={mode}
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
        {mode === 'floating' && (
          <div className="reader-note-floating-controls">
            <button type="button" className="reader-note-floating-drag" aria-label="拖动悬浮速记卡（方向键微调，Escape 回到分屏）" onPointerDown={startFloatingDrag}>拖动</button>
            <button type="button" className="reader-note-floating-resize" aria-label="调整悬浮速记卡大小" onPointerDown={startFloatingResize} />
          </div>
        )}
        {drawerOpen && (
          <aside className="reader-workspace-drawer" style={{ width: mode === 'split' ? drawerWidth + 'px' : undefined }} data-drawer-width={mode === 'split' ? drawerWidth : 'auto'}>
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

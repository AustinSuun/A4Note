import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/ui/styles/tokens.css';
import '/src/ui/styles/reader.css';
import '/src/features/reader/reader-writing-layout.css';
import { ReaderNoteModeSwitch } from '/src/features/reader/ReaderNoteWorkbenchMenu';
import { useReaderDrawerLayout } from '/src/features/reader/useReaderDrawerLayout';
import { useNoteWorkbench } from '/src/features/reader/useNoteWorkbench';
import { useNotePanelPresence } from '/src/features/reader/useNotePanelPresence';
import { floatingPopOrigin } from '/src/features/reader/noteEnterMotion';
import { floatingCardBox, splitWidthPx } from '/src/features/reader/noteWorkbench';

/* Enter-motion host (task 1f484418): mirrors ReaderScene's presence wiring — the shell's
   data-note-presence / data-note-motion-mode attributes, the retained drawer, the floating
   controls and the --note-pop-origin variable — on top of the real state hook, presence
   hook, geometry helpers and layout CSS. Buttons are real DOM controls so the verifier can
   trigger discrete React events and read the very first committed frame. */
const HEIGHT = 620;

function Host() {
  const [containerWidth, setContainerWidth] = useState(1440);
  const { containerRef } = useReaderDrawerLayout();
  const workbench = useNoteWorkbench('paper-motion', containerWidth);
  const [draft, setDraft] = useState('入场动效草稿');
  const mode = workbench.mode;
  const drawerOpen = mode !== 'reading';
  const notePresence = useNotePanelPresence(drawerOpen, mode);
  const drawerPresented = drawerOpen || notePresence.phase !== 'hidden';
  const presentationMode = drawerOpen ? mode : drawerPresented ? notePresence.mode : 'reading';
  const writingExpanded = mode === 'writing';
  const drawerWidth = splitWidthPx(containerWidth, workbench.prefs.splitRatio);
  const floatingRect = workbench.prefs.floating;
  const floatingBox = floatingCardBox(floatingRect, containerWidth, HEIGHT);
  const floatingPresented = presentationMode === 'floating' && drawerPresented;
  const floatingStyle = floatingPresented ? {
    '--floating-note-left': floatingRect.x * 100 + '%',
    '--floating-note-top': floatingRect.y * 100 + '%',
    '--floating-note-width': floatingRect.width * 100 + '%',
    '--floating-note-height': floatingRect.height * 100 + '%',
    '--note-pop-origin': floatingPopOrigin(floatingRect),
  } : {};
  const renderCount = useRef(0);
  renderCount.current += 1;

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

  useEffect(() => {
    const log = window.__presenceLog || [];
    const last = log.at(-1);
    if (!last || last.phase !== notePresence.phase || last.mode !== presentationMode) {
      window.__presenceLog = [...log, { phase: notePresence.phase, mode: presentationMode, t: performance.now() }];
    }
    window.__motionHost = { setMode: workbench.setMode, setWidth: setContainerWidth, setFloating: workbench.setFloatingRect, restoreMode: workbench.restoreMode };
    window.__motionState = {
      containerWidth, mode, requested: workbench.requestedMode, temporary: workbench.temporary, presence: notePresence.phase, presentationMode,
      drawerOpen, drawerPresented, drawerWidth, floatingRect, floatingBox, popOrigin: floatingPresented ? floatingPopOrigin(floatingRect) : null,
      renders: renderCount.current,
    };
  });

  return (
    <div className="motion-harness">
      <div className="motion-harness-toolbar">
        <button type="button" className="motion-open" data-mode="split" onClick={() => workbench.setMode('split')}>open split</button>
        <button type="button" className="motion-open" data-mode="floating" onClick={() => workbench.setMode('floating')}>open floating</button>
        <button type="button" className="motion-open" data-mode="writing" onClick={() => workbench.setMode('writing')}>open writing</button>
        <button type="button" className="motion-close" onClick={() => workbench.setMode('reading')}>close</button>
        <button type="button" className="motion-float" data-side="right" onClick={() => workbench.setFloatingRect({ x: 0.5, y: 0.14, width: 0.42, height: 0.62 })}>float right</button>
        <button type="button" className="motion-float" data-side="left" onClick={() => workbench.setFloatingRect({ x: 0.04, y: 0.14, width: 0.42, height: 0.62 })}>float left</button>
        <button type="button" className="motion-float" data-side="centre" onClick={() => workbench.setFloatingRect({ x: 0.29, y: 0.14, width: 0.42, height: 0.62 })}>float centre</button>
        <button type="button" className="motion-width" data-width="900" onClick={() => setContainerWidth(900)}>900</button>
        <button type="button" className="motion-width" data-width="1440" onClick={() => setContainerWidth(1440)}>1440</button>
      </div>
      <div
        ref={containerRef}
        className={'reader-workspace-shell note-mode-' + presentationMode + (drawerPresented ? ' workspace-open' : '') + (writingExpanded ? ' writing-expanded' : '')}
        data-note-mode={mode}
        data-note-motion-mode={presentationMode}
        data-note-presence={notePresence.phase}
        data-note-requested-mode={workbench.requestedMode}
        data-note-temporary={workbench.temporary ? 'true' : 'false'}
        style={{ position: 'relative', width: containerWidth + 'px', height: HEIGHT + 'px', '--reader-side-width': drawerWidth + 'px', ...floatingStyle }}
      >
        <div className="reader-main-workspace" inert={writingExpanded} aria-hidden={writingExpanded}>
          <div className="motion-harness-pdf pdf-document" style={{ width: mode === 'split' ? containerWidth - drawerWidth - 12 : containerWidth, overflow: 'auto' }}><div style={{ height: 1800, flex: '0 0 auto' }}>PDF scroll surface</div></div>
        </div>
        {floatingPresented && (
          <div className="reader-note-floating-controls" inert={!drawerOpen} aria-hidden={!drawerOpen}>
            <button type="button" className="reader-note-floating-drag" aria-label="拖动悬浮速记卡（方向键微调，Escape 回到分屏）" onPointerDown={startFloatingDrag}><span className="reader-note-floating-grip" aria-hidden="true" /></button>
            <button type="button" className="reader-note-floating-resize" aria-label="调整悬浮速记卡大小" />
          </div>
        )}
        {drawerPresented && (
          <aside className="reader-workspace-drawer notes-active" inert={!drawerOpen} aria-hidden={!drawerOpen} data-note-presence={notePresence.phase} style={{ width: presentationMode === 'split' ? drawerWidth + 'px' : undefined }}>
            <header className="reader-workspace-header">
              <div className="reader-workspace-tabs" role="tablist" aria-label="面板"><button type="button" className="reader-workspace-tab active" role="tab" aria-selected="true">笔记</button></div>
              <div className="reader-workspace-actions"><ReaderNoteModeSwitch mode={mode} onSelectMode={workbench.setMode} /></div>
            </header>
            <div className="reader-retained-note">
              <div className="note-workspace">
                <textarea className="md-body markdown-live-codemirror" data-note-editor="1" value={draft} onChange={(event) => setDraft(event.target.value)} />
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Host />);

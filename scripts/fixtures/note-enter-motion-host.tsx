import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/ui/styles/tokens.css';
import '/src/ui/styles/reader.css';
import '/src/features/explorer/markdown-authoring.css';
import '/src/features/explorer/markdown-dock-layout.css';
import '/src/features/reader/reader-writing-layout.css';
import { ReaderNoteModeSwitch } from '/src/features/reader/ReaderNoteWorkbenchMenu';
import { ReaderNoteFloatingControls } from '/src/features/reader/ReaderNoteFloatingControls';
import { useReaderDrawerLayout } from '/src/features/reader/useReaderDrawerLayout';
import { useNoteWorkbench } from '/src/features/reader/useNoteWorkbench';
import { useNotePanelPresence } from '/src/features/reader/useNotePanelPresence';
import { useNoteLayoutFlip } from '/src/features/reader/useNoteLayoutFlip';
import { floatingPopOrigin } from '/src/features/reader/noteEnterMotion';
import { floatingCardBox, splitWidthPx } from '/src/features/reader/noteWorkbench';

/* Motion host (tasks 1f484418 / 3932f561): mirrors ReaderScene's presence wiring — the shell's
   data-note-* attributes, the note track variables (--reader-side-width / --reader-side-target),
   the retained drawer with the real note header layout, the real floating controls (drag lane +
   four corner grips), the shared Markdown dock and the --note-pop-origin variable — on top of
   the real state hook, presence hook, FLIP hook, geometry helpers and layout CSS. Buttons are
   real DOM controls so the verifier can trigger discrete React events and read the very first
   committed frame. */
const HEIGHT = 620;
const DOCK_ACTIONS = ['预览', '大纲', '加粗', '斜体', '下划线', '删除线', '行内代码', '高亮', '列表', '编号', '任务', '标题', '链接', '引用', '脚注', '分隔线', '提示块', '代码块', '公式', '表格', '图片', '更多'];

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
  const floatingActive = drawerOpen && mode === 'floating';
  const noteTrackOpen = presentationMode !== 'split' || notePresence.phase === 'entered';
  const floatingStyle = floatingPresented ? {
    '--floating-note-left': floatingRect.x * 100 + '%',
    '--floating-note-top': floatingRect.y * 100 + '%',
    '--floating-note-width': floatingRect.width * 100 + '%',
    '--floating-note-height': floatingRect.height * 100 + '%',
    '--note-pop-origin': floatingPopOrigin(floatingRect),
  } : {};
  const renderCount = useRef(0);
  renderCount.current += 1;
  useNoteLayoutFlip(containerRef, presentationMode, drawerPresented, JSON.stringify([drawerWidth, containerWidth, floatingRect, notePresence.phase]));

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
      trackOpen: noteTrackOpen, renders: renderCount.current,
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
        <button type="button" className="motion-float" data-side="small" onClick={() => workbench.setFloatingRect({ x: 0.7, y: 0.2, width: 0.24, height: 0.4 })}>float small</button>
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
        style={{ position: 'relative', width: containerWidth + 'px', height: HEIGHT + 'px',
          '--reader-side-width': (noteTrackOpen ? drawerWidth : 0) + 'px', '--reader-side-target': drawerWidth + 'px', ...floatingStyle }}
      >
        <div className="reader-main-workspace" inert={writingExpanded} aria-hidden={writingExpanded}>
          <div className="motion-harness-pdf pdf-document" style={{ width: '100%', height: '100%', overflow: 'auto' }}><div style={{ height: 1800, flex: '0 0 auto' }}>PDF scroll surface</div></div>
        </div>
        {floatingPresented && (
          <ReaderNoteFloatingControls active={floatingActive} rect={floatingRect} containerRef={containerRef}
            onRectChange={workbench.setFloatingRect} onEscape={() => workbench.setMode('split')} />
        )}
        {drawerPresented && (
          <aside className="reader-workspace-drawer notes-active" inert={!drawerOpen} aria-hidden={!drawerOpen} data-note-presence={notePresence.phase}>
            <div className="workspace-panel-content"><div className="reader-retained-note">
              <div className="note-workspace">
                <header className="note-document-header">
                  <div className="note-history-shell">
                    <button type="button" className="note-document-trigger" aria-haspopup="listbox"><span>阅读笔记 2</span><svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" /></svg></button>
                  </div>
                  <div className="note-document-actions">
                    <ReaderNoteModeSwitch mode={mode} onSelectMode={workbench.setMode} />
                    <span className="note-save-state saved"><svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>已保存</span>
                    <div className="note-view-switch"><button type="button" className="active" aria-label="实时编辑">✎</button><button type="button" aria-label="阅读">▤</button></div>
                  </div>
                </header>
                <textarea className="md-body markdown-live-codemirror" data-note-editor="1" value={draft} onChange={(event) => setDraft(event.target.value)} />
                <div className="markdown-authoring-dock"><div className="markdown-authoring-actions">
                  {DOCK_ACTIONS.map(label => <button key={label} type="button" title={label}><span className="markdown-dock-icon" aria-hidden="true">●</span></button>)}
                </div></div>
              </div>
            </div></div>
          </aside>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Host />);

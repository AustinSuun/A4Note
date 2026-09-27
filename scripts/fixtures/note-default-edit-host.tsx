// Synthetic host for the per-open default-edit rule and the redesigned workbench menu.
// Real reader modules (content-mode hook, retained note wrapper, workbench menu,
// shortcut registration) run against a minimal shell; no library, task service or
// native data is touched.
import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useNoteContentMode } from '../../src/features/reader/noteContentMode';
import { RetainedReaderNote } from '../../src/features/reader/ReaderNoteActivity';
import { ReaderNoteWorkbenchMenu } from '../../src/features/reader/ReaderNoteWorkbenchMenu';
import { NOTE_WORKBENCH_COMMANDS, modeForNoteWorkbenchCommand, type NoteWorkbenchMode } from '../../src/features/reader/noteWorkbench';
import { useReaderWritingShortcuts } from '../../src/features/reader/useReaderWritingShortcuts';
import '../../src/ui/styles/tokens.css';
import '../../src/features/reader/reader-writing-layout.css';

function MiniNotePanel({ active }: { active: boolean }) {
  const [mode, setMode] = useNoteContentMode(active);
  return (
    <div className="note-workspace" data-content-mode={mode}>
      <header className="note-document-header">
        <div className="note-view-switch" role="group" aria-label="内容状态">
          <button type="button" className={mode === 'edit' ? 'active' : ''} aria-label="编辑模式" onClick={() => setMode('edit')}>编辑</button>
          <button type="button" className={mode === 'read' ? 'active' : ''} aria-label="阅读模式" onClick={() => setMode('read')}>阅读</button>
        </div>
      </header>
      {mode === 'edit'
        ? <textarea className="harness-editor" aria-label="笔记正文" defaultValue={'# 阅读笔记\n\n立即可编辑的正文。'} />
        : <article className="md-body note-preview-only"><h1>阅读笔记</h1><p>渲染后的阅读态正文。</p></article>}
    </div>
  );
}

function Harness() {
  const [active, setActive] = useState(true);
  const [mode, setMode] = useState<NoteWorkbenchMode>('split');
  const shellRef = useRef<HTMLDivElement | null>(null);
  const runCommand = (command: string) => {
    const next = modeForNoteWorkbenchCommand(command);
    if (next) {
      if (next === 'reading') setActive(false);
      else { setActive(true); setMode(next); }
      return;
    }
    if (command === NOTE_WORKBENCH_COMMANDS.toggle) {
      if (active) setActive(false);
      else { setActive(true); if (mode === 'reading') setMode('split'); }
    }
  };
  useReaderWritingShortcuts(shellRef, runCommand);
  return (
    <div ref={shellRef} className="harness-shell reader-workspace-shell" data-note-mode={mode} data-note-presence={active ? 'entered' : 'hidden'}>
      <div className="harness-toolbar">
        <button id="harness-toggle" type="button" onClick={() => setActive(current => !current)}>{active ? '收起笔记' : '打开笔记'}</button>
        <span id="harness-active" data-active={String(active)}>{active ? 'open' : 'closed'}</span>
      </div>
      <div className="harness-body">
        <div className="harness-pdf" aria-hidden="true">PDF 区域</div>
        <RetainedReaderNote active={active} visible={active}>
          <MiniNotePanel active={active} />
        </RetainedReaderNote>
      </div>
      <ReaderNoteWorkbenchMenu
        mode={mode}
        onToggle={() => runCommand(NOTE_WORKBENCH_COMMANDS.toggle)}
        onSelectMode={next => { if (next === 'reading') setActive(false); else { setActive(true); setMode(next); } }}
        onNewNote={() => { /* creation is covered by the real-app evidence */ }}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);

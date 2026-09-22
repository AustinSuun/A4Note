// Real React/DOM regression harness for the keyboard-only PDF search entry (card 6a2240f7).
// It mounts the production PdfFindBar inside a reader surface together with the real shortcut
// provider and app commands; it is deliberately not the native application.
import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShortcutProvider, useShortcutCommands, useShortcutContext, useShortcutProps, useShortcuts } from '../../src/shared/shortcuts';
import { createAppShortcutCommands } from '../../src/ui/shortcuts/appShortcutCommands';
import { PdfFindBar } from '../../src/features/reader/pdf/PdfFindBar';
import { requestPdfFind } from '../../src/features/reader/readerNavigation';
import type { PageMeta } from '../../src/features/reader/pdf/types';
const events: string[] = [];
const hit = (s: string) => () => { events.push(s); };
const LINES = ['Mean Flows for One-step Generative Modeling', 'average velocity characterizes flow fields', 'instantaneous velocity modeled by Flow Matching'];
function Harness() {
  const [scene, setScene] = useState('reader');
  const [pdfMode, setPdfMode] = useState(true);
  const [documentKey, setDocumentKey] = useState('doc-a');
  const surface = useRef<HTMLDivElement>(null);
  const pages = useMemo(() => [{ pageNumber: 1, baseWidth: 612, baseHeight: 792, pdfPage: null as never, textItems: LINES.map((text, i) => ({ text, x: 10, y: 10 + i * 5, width: 80, height: 3, fontSize: 11 })) }] as unknown as PageMeta[], []);
  useShortcutCommands(createAppShortcutCommands({
    scenes: [{ id: 'library', label: '文献库', key: '2' }, { id: 'reader', label: '阅读器', key: '3' }], hasPaper: true, pdfMode, focusedAnnotation: false, canUndo: false, canRedo: false,
    palette: hit('palette'), openScene: setScene, importPdf: hit('import'), librarySearch: hit('library-search'),
    pdfSearch: () => { events.push(requestPdfFind() ? 'pdf-search:dispatched' : 'pdf-search:no-surface'); },
    undo: hit('undo'), redo: hit('redo'), deleteAnnotation: hit('delete'), cancel: () => { events.push('cancel'); return true; }, selectTool: t => events.push(t), pdfZoom: hit('pdf-zoom'), fitWidth: hit('fit'), uiZoom: hit('ui-zoom'),
  }));
  useShortcutContext(scene, false);
  const props = useShortcutProps(), store = useShortcuts();
  (window as any).__findTest = { store, events, setScene, setPdfMode, setDocumentKey };
  return <main style={{ padding: 16 }}>
    <nav><button {...props('scene.library', 'Library')} onClick={() => setScene('library')}>Library</button><button {...props('scene.reader', 'Reader')} onClick={() => setScene('reader')}>Reader</button></nav>
    <div style={{ position: 'fixed', top: 8, right: 12, display: 'flex', gap: 4 }}>{['zoomOut', 'fitWidth', 'zoomIn'].map((t, i) => <button key={t} style={{ width: 30, height: 30, margin: 0 }} {...props('reader.' + t, t)}>{['−', '↔', '+'][i]}</button>)}</div>
    <div id="canvas" tabIndex={0}>Canvas</div>
    <div className="workbench-tab-frame active" style={{ display: scene === 'reader' ? 'block' : 'none' }}>
      <div className="pdf-keepalive-pane active">
        {pdfMode
          ? <div className="pdf-reader-surface" data-reader-layer="pdf-surface" ref={surface} style={{ position: 'relative', width: 640, height: 360, border: '1px solid #bbc8bf', overflow: 'hidden' }}>
              <div className="pdf-document" tabIndex={-1} style={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
                <div className="pdf-page" data-page="1" style={{ position: 'relative', width: 600, height: 700 }}>
                  <div className="pdf-text-layer">{LINES.map((text, i) => <span key={i} data-text-index={i} style={{ position: 'absolute', left: 20, top: 20 + i * 24 }}>{text}</span>)}</div>
                </div>
              </div>
              <PdfFindBar surface={surface} pages={pages} documentKey={documentKey} />
            </div>
          : <div className="markdown-reader-surface" style={{ width: 640, height: 360, border: '1px dashed #bbc8bf' }}>Markdown mode: no PDF surface</div>}
      </div>
    </div>
    <div id="a4note-live-dev-badge" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 26, background: '#174e38', color: 'white' }}>DEV browser component fixture — not native</div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ShortcutProvider><Harness /></ShortcutProvider></React.StrictMode>);

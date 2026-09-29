// Harness entry for verify-pdf-links-browser.mjs (card e4c2fa22): the real PdfReader on the link fixture,
// with the tool, zoom and document switchable from CDP and the Alt+← plumbing reachable.
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PdfReader from '/src/features/reader/pdf/PdfReader';
import { defaultReaderToolSettings } from '/src/features/reader/pdf/types';
// Namespace import so the harness still builds on a tree without the link feature (the checks then fail).
import * as readerNavigation from '/src/features/reader/readerNavigation';
import '/src/ui/styles.css';

const sourceFor = (fileId: string) => ({ key: `harness:${fileId}`, title: 'Link fixture', fileId, request: { source: 'paperFile', paperId: 'harness', kind: 'source', fileId } });
let counter = 0;
function Harness() {
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [tool, setTool] = useState<any>('cursor');
  const [zoom, setZoom] = useState(1);
  const [fileId, setFileId] = useState('file-1');
  const [focused, setFocused] = useState<string | null>(null);
  const [readerState, setReaderState] = useState({ currentPage: 1, totalPages: 0 });
  const latest = useRef(annotations); latest.current = annotations;
  (window as any).__pdfHarness = {
    setTool, setZoom, setFileId, linkBack: () => (readerNavigation as any).requestPdfLinkBack?.() ?? false,
    readerState: () => readerState, annotations: () => latest.current,
    reset: () => { setAnnotations([]); setFocused(null); },
  };
  return <div style={{ position: 'fixed', inset: 0, display: 'flex' }}>
    <div className="reader-document-pane" style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <PdfReader source={sourceFor(fileId) as any} annotations={annotations} activeTool={tool} activeAnnotationColor={'blue' as any} toolSettings={defaultReaderToolSettings}
        onCompleteOneShotTool={() => setTool('cursor')} zoom={zoom} onZoomChange={(z) => setZoom(z)}
        onCreateAnnotation={async (draft) => { const id = 'new-' + (++counter); setAnnotations(list => [...list, { id, paperId: 'harness', fileId, createdAt: new Date().toISOString(), ...draft }]); return id; }}
        onUpdateAnnotationComment={async () => {}} onUpdateAnnotationPosition={async (id, positionJson) => setAnnotations(list => list.map(a => a.id === id ? { ...a, positionJson } : a))} onUpdateAnnotationColor={async () => {}}
        onDeleteAnnotation={async (id) => setAnnotations(list => list.filter(a => a.id !== id))} onAppendAnnotationToNote={() => {}}
        onReaderStateChange={setReaderState}
        onFocusAnnotation={(id) => setFocused(id)} focusedAnnotationId={focused} />
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);

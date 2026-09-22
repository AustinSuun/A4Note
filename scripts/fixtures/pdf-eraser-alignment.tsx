// Real PdfReader/ink/text-layer fixture; native evidence is collected separately.
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PdfReader from '/src/features/reader/pdf/PdfReader';
import { defaultReaderToolSettings } from '/src/features/reader/pdf/types';
import '/src/ui/styles.css';
const source = { key: 'harness:file-1', title: 'Synthetic', fileId: 'file-1', request: { source: 'paperFile', paperId: 'harness', kind: 'source', fileId: 'file-1' } };
let counter = 0;
function Harness() {
    const [annotations, setAnnotations] = useState<any[]>([]);
    const [tool, setTool] = useState<any>('cursor');
    const [zoom, setZoom] = useState(1);
    const [sidebar, setSidebar] = useState(0);
    const [shape, setShape] = useState<any>('round');
    const [focused, setFocused] = useState<string | null>(null);
    const latest = useRef(annotations);
    latest.current = annotations;
    const latestFocused = useRef(focused);
    latestFocused.current = focused;
    (window as any).__pdfHarness = { setTool, setZoom, setSidebar, setShape, annotations: () => latest.current, focused: () => latestFocused.current, reset: () => { setAnnotations([]); setFocused(null); }, replaceAnnotations: (next: any[]) => setAnnotations(next) };
    return <div style={{ position: 'fixed', inset: 0, display: 'flex' }}>
    <div className="harness-sidebar" style={{ width: sidebar, flex: '0 0 auto', background: '#dde5df' }}/>
    <div className="reader-document-pane" style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <PdfReader source={source as any} annotations={annotations} activeTool={tool} activeAnnotationColor={'blue' as any} toolSettings={{ ...defaultReaderToolSettings, eraserSize: 28, eraserShape: shape }} onCompleteOneShotTool={() => setTool('cursor')} zoom={zoom} onZoomChange={(z) => setZoom(z)} onCreateAnnotation={async (draft) => { const id = 'new-' + (++counter); setAnnotations(list => [...list, { id, paperId: 'harness', fileId: 'file-1', createdAt: new Date().toISOString(), ...draft }]); return id; }} onUpdateAnnotationComment={async () => { }} onUpdateAnnotationPosition={async (id, positionJson) => setAnnotations(list => list.map(a => a.id === id ? { ...a, positionJson } : a))} onUpdateAnnotationColor={async () => { }} onDeleteAnnotation={async (id) => setAnnotations(list => list.filter(a => a.id !== id))} onAppendAnnotationToNote={() => { }} onFocusAnnotation={(id) => setFocused(id)} focusedAnnotationId={focused}/>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);

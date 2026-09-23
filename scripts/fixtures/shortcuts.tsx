// Real React/DOM regression harness, deliberately not the native application.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShortcutProvider, ShortcutEditor, useShortcutProps } from '../../src/shared/shortcuts';
import { useAppShortcuts } from '../../src/ui/shortcuts/useAppShortcuts';
import { ReaderNoteWorkbenchMenu } from '../../src/features/reader/ReaderNoteWorkbenchMenu';
import { useReaderWritingShortcuts } from '../../src/features/reader/useReaderWritingShortcuts';
import { useRef } from 'react';
const events: string[] = [];
const hit = (s: string) => () => { events.push(s); };
function Harness() {
  const [scene, setScene] = useState('reader');
  const [modal, setModal] = useState(false);
  const [fileMode, setFileMode] = useState<'source' | 'translated' | 'parallel'>('source');
  const [hasTranslation, setHasTranslation] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const store = useAppShortcuts(scene, modal, {
    scenes:[{id:'library',label:'文献库',key:'2'},{id:'reader',label:'阅读器',key:'3'}], hasPaper:true,pdfMode:true,hasSourcePdf:true,hasTranslatedPdf:hasTranslation,focusedAnnotation:true,canUndo:true,canRedo:true,
    palette:hit('palette'),openScene:setScene,importPdf:hit('import'),librarySearch:hit('library-search'),pdfSearch:hit('pdf-search'),undo:hit('undo'),redo:hit('redo'),
    deleteAnnotation:hit('delete'),cancel:()=>{events.push('cancel');return true;},selectTool:t=>events.push(t),selectReaderFileMode:mode=>{setFileMode(mode);events.push('file-'+mode);},pdfZoom:hit('pdf-zoom'),fitWidth:hit('fit'),uiZoom:hit('ui-zoom'),
  });
  useReaderWritingShortcuts(root, c=>events.push(c));
  const props = useShortcutProps();
  (window as any).__shortcutsTest = { store, events, setScene, setModal, setHasTranslation, fileMode };
  return <main style={{padding:20, maxWidth:850}}>
    <h1>Shortcut component regression harness</h1>
    <nav><button {...props('scene.library','Library')} onClick={()=>setScene('library')}>Library</button><button {...props('scene.reader','Reader')} onClick={()=>setScene('reader')}>Reader</button><button onClick={()=>setModal(!modal)}>Modal</button></nav>
    <div id="canvas" tabIndex={0}>Canvas</div><input id="input"/><textarea id="textarea"/><select id="select"><option>one</option></select>
    <div id="editable" contentEditable suppressContentEditableWarning>Editable</div><div className="cm-editor"><div id="cm" contentEditable/></div>
    {modal && <div role="dialog" aria-modal="true">Modal dialog</div>}
    <div ref={root} style={{display:scene==='reader'?'block':'none'}}>
      <div id="reader-file-controls" style={{display:'flex',gap:8,background:'#fff',margin:'0 0 -4px'}}>
        {(['source','translated','parallel'] as const).map((mode,i)=><button key={mode} data-file-mode={mode} {...props('reader.file.'+mode,['原文','译文','对照'][i])} aria-pressed={fileMode===mode} disabled={mode!=='source'&&!hasTranslation} onClick={()=>setFileMode(mode)}>{['原文','译文','对照'][i]}</button>)}
      </div>
      <div id="tool-dock" style={{display:'flex',gap:4,position:'fixed',zIndex:200,background:'#fff',bottom:42,left:'50%',transform:'translateX(-50%)',padding:8}}>{['cursor','highlight','underline','area','text','ink','eraser','rect','arrow'].map(t=><button key={t} style={{width:30,height:30,margin:0,padding:0}} aria-label={t} {...props('reader.tool.'+t,t)}>{t.slice(0,1).toUpperCase()}</button>)}</div>
      <ReaderNoteWorkbenchMenu mode="reading" onToggle={hit('toggle')} onSelectMode={hit('mode')}/>
    </div>
    <div style={{position:'fixed',top:8,right:12,display:'flex',gap:4}}>{['zoomOut','fitWidth','zoomIn'].map((t,i)=><button key={t} style={{width:30,height:30,margin:0}} {...props('reader.'+t,t)}>{['−','↔','+'][i]}</button>)}</div>
    <div id="a4note-live-dev-badge" style={{position:'fixed',bottom:0,left:0,right:0,height:26,background:'#174e38',color:'white'}}>DEV browser component fixture — not native</div>
    <ShortcutEditor sceneId={scene==='reader'?'reader':undefined}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ShortcutProvider><Harness/></ShortcutProvider></React.StrictMode>);

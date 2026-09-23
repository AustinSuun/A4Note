import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReaderPageControl } from '../../src/features/reader/ReaderPageControl';
import { DocumentToolbarActiveContext } from '../../src/workbench/DocumentToolbar';
import { ReaderNoteActivity } from '../../src/features/reader/ReaderNoteActivity';
import '../../src/ui/styles/tokens.css';
import '../../src/ui/styles/components.css';

type State = { paperId: string; documentKey: string; currentPage: number; totalPages: number; active: boolean; visible: boolean };
function Host() {
  const [state, setState] = useState<State>({ paperId: 'a', documentKey: 'source-a', currentPage: 2, totalPages: 16, active: true, visible: true });
  const api = window as typeof window & { pageControlTest: { patch: (value: Partial<State>) => void; calls: number[]; state: State } };
  api.pageControlTest ??= { patch: () => {}, calls: [], state };
  api.pageControlTest.patch = value => setState(old => ({ ...old, ...value }));
  api.pageControlTest.state = state;
  return <><button id="before">Before</button><div style={{ position: 'relative', height: 130, margin: 12 }}>
    <DocumentToolbarActiveContext.Provider value={state.active}><ReaderNoteActivity.Provider value={state.visible}>
      <ReaderPageControl {...{ paperId: state.paperId, documentKey: state.documentKey }} readerPageState={state} onJumpToPage={page => {
        api.pageControlTest.calls.push(page); setState(old => ({ ...old, currentPage: page }));
      }} />
    </ReaderNoteActivity.Provider></DocumentToolbarActiveContext.Provider>
  </div><button id="after">After</button><button id="switch-file" onClick={() => setState(old => ({ ...old, documentKey: 'clicked-translation', currentPage: 3 }))}>Switch PDF</button><button id="switch-paper" onClick={() => setState(old => ({ ...old, paperId: 'clicked-paper', currentPage: 3 }))}>Switch paper</button><div id="blank" style={{ height: 120 }}>Non-focusable outside surface</div></>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Host /></React.StrictMode>);

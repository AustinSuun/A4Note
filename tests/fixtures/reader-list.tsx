import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ReaderSceneSidebar} from '../../src/features/reader/ReaderSceneSidebar';
import '../../src/ui/styles.css';
const initial:any[]=[
 {id:'pdf',title:'Mean Flows for One-step Generative Modeling — long title.pdf',fileType:'pdf',paperId:'p1',notes:[{id:'n1',paperId:'p1',title:'合成笔记一',content:'',format:'markdown'}]},
 {id:'md',title:'A4Note 使用指南',fileType:'markdown',paperId:'p2',notes:[]},
 {id:'unknown',title:'An unknown resource.pdf',fileType:'unknown'},
];
function App(){const [items,setItems]=useState(initial),[active,setActive]=useState('md');
 (window as any).resetFixture=()=>{setItems(initial);setActive('md');(window as any).events=[]};
 (window as any).events ??=[];
 const log=(type:string,id:string)=>(window as any).events.push({type,id});
 return <main style={{padding:24,height:'100vh',background:'var(--bg)'}}><aside id="fixture-sidebar" style={{width:320,background:'var(--surface)',height:600}}><ReaderSceneSidebar openItems={items.map(i=>({...i,active:active===i.id}))} onSelectItem={id=>{log('select',id);setActive(id)}} onCloseItem={id=>{log('close',id);setItems(x=>x.filter(i=>i.id!==id))}} onOpenNote={(_,id)=>log('note',id)} onCreateNote={id=>log('create',id)}/></aside></main>
}
createRoot(document.getElementById('root')!).render(<App/>);

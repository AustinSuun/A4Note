import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ReaderToolbar} from '../../src/features/reader/ReaderToolbar';
import {defaultReaderToolSettings} from '../../src/features/reader/pdf/types';
import '../../src/ui/styles.css';
const annotation={id:'synthetic-text',page:1,type:'text' as const,color:'green',comment:'Original saved text',quote:'',positionJson:{x:10,y:15,width:45,height:12,textColor:'#202822',fontSize:13}};
const paper:any={id:'synthetic-only',title:'Artificial audit fixture',sourcePdf:{id:'fake'},translatedPdfs:[],translatedFileIds:[]};
function App(){const [tool,setTool]=useState<any>('cursor'),[color,setColor]=useState<any>('yellow'),[custom,setCustom]=useState('#202822'),[settings,setSettings]=useState(defaultReaderToolSettings),[editing,setEditing]=useState(true),[text,setText]=useState('Original saved text');
(window as any).auditState={tool,color,custom,settings,editing,text};
return <main style={{height:'100vh',position:'relative',overflow:'hidden'}}>
 <div style={{padding:16,fontSize:14}}>阅读菜单焦点回归 · 隔离组件检查 · 人工数据（非安装版／非完整阅读器）</div>
 <div className="pdf-page" style={{position:'relative',width:600,height:500,margin:'30px auto',background:'white'}}><p style={{padding:20}}>人工页面，仅用于标注组件与菜单交互检查，不作为保存或 PDF 坐标验收。</p>
 </div>
 <ReaderToolbar paper={paper} contentMode="pdf" fileMode="source" currentTranslatedFileId="" parallelSyncLocked={false} activeAnnotationTool={tool} activeAnnotationColor={color} customAnnotationColor={custom} toolSettings={settings} zoom={1} onFileModeChange={()=>{}} onContentModeChange={()=>{}} onTranslatedFileIdChange={()=>{}} onParallelSyncLockedChange={()=>{}} onSelectAnnotationTool={setTool} onSelectAnnotationColor={setColor} onCustomAnnotationColorChange={setCustom} onToolSettingsChange={setSettings} onZoomChange={()=>{}} onFitWidth={()=>{}}/>
 </main>}
createRoot(document.getElementById('root')!).render(<App/>);

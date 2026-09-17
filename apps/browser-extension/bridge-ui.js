import {revealProgress,cancelProgressReveal} from './compact-view.js';
import {renderTaskProgress,renderTaskDetails} from './task-progress.js';
import {createFolderTree} from './folder-tree.js';
import {nativeHello,authorizeNative,sendCapture,captureTasks,captureFolders,disconnectBridge,bridgeError,onBridgeDisconnect,supportsCaptureFlow,retryCapture} from './bridge.mjs';

export function setupBridge(getEnvelope,status){
  const get=id=>document.getElementById(id);
  let ready=false,compatible=false,sending=false,authorizing=false,loadingFolders=false,accepted=false;
  let connectionEpoch=0,folderEpoch=0,pollEpoch=0,frozen=null,scanning=true,tasksBusy=false,completionLabel=null,watchedId=null;
  const tree=createFolderTree({root:get('folder-tree'),selectionLabel:get('folder-selection'),memoryLabel:get('folder-memory-status'),toggleAll:get('folders-toggle-all'),locate:get('folder-locate'),clearMemory:get('folder-memory-clear'),onChange:()=>{get('folder-status').textContent=tree.value?'已选择文件夹，点击下载并导入。':'请选择文件夹后导入。';sync();}});
  const sync=()=>{
    get('send').disabled=!ready||!compatible||scanning||loadingFolders||sending||accepted||!getEnvelope()||(!frozen&&!tree.value);
    get('send').dataset.state=accepted&&completionLabel==='已完成'?'complete':sending||accepted&&!completionLabel?'busy':ready&&compatible?'ready':'unavailable';
    get('send').textContent=sending?'处理中':accepted?(completionLabel||'处理中'):frozen?'确认提交':'下载';
    get('folder-selection').hidden=!tree.value;
    tree.disabled=!ready||!compatible||loadingFolders||sending||Boolean(frozen);
    get('folders-refresh').disabled=!ready||!compatible||loadingFolders||sending||Boolean(frozen);
    get('scan').disabled=scanning||sending||authorizing;
    get('connect').disabled=authorizing||sending;
    get('reconnect').disabled=authorizing||sending;
    get('scan-progress').hidden=!scanning;
    for(const button of document.querySelectorAll('[data-retry]'))button.disabled=sending||!ready||!compatible;
    for(const button of document.querySelectorAll('[data-assist]'))button.disabled=!accepted||sending||!ready||!compatible;
  };
  const placeholder=text=>tree.placeholder(text);
  const connected=(message,ok)=>{
    ready=ok;get('connection-status').textContent=message;get('connection-status').dataset.connected=String(ok);
    get('connect').hidden=ok;get('reconnect').hidden=ok;get('connection-help').open=!ok&&!message.includes('正在');sync();
  };
  const showFolders=rows=>{
    const result=tree.setFolders(rows);
    get('folder-status').textContent=result.missingSelection?'上次文件夹已删除或层级异常，请重新选择。':!result.count?'文献库暂无分类，请先在桌面创建。':result.invalid?'有目录层级异常，已禁止选择；请在桌面整理。':result.restored?'已恢复上次保存位置，可直接下载并导入。':'点击文件夹选择；箭头展开或收起子目录。';
  };
  const loadFolders=async()=>{
    if(!getEnvelope()||!ready||!compatible||frozen)return;
    const epoch=++folderEpoch,source=getEnvelope();loadingFolders=true;sync();get('folder-status').textContent='正在读取桌面分类…';
    try{
      await tree.ready;
      if(epoch!==folderEpoch||source!==getEnvelope())return;
      const result=await captureFolders();
      if(epoch!==folderEpoch||source!==getEnvelope())return;
      showFolders(result.folders);connected('桌面已就绪',true);
    }catch(error){
      if(epoch!==folderEpoch)return;
      placeholder('文件夹暂不可用');get('folder-status').textContent=bridgeError(error);
      connected(['native_disconnected','native_host_missing','desktop_unavailable'].includes(error.code)?'桌面连接已中断':'文件夹读取失败，请重试',false);
    }finally{if(epoch===folderEpoch){loadingFolders=false;sync();}}
  };
  const restore=async()=>{
    const epoch=++connectionEpoch;++folderEpoch;loadingFolders=false;
    compatible=false;connected('正在连接 A4 Note…',false);get('connect').hidden=true;
    try{
      const result=await nativeHello();if(epoch!==connectionEpoch)return;
      compatible=supportsCaptureFlow(result);
      connected(!compatible?'需要更新桌面通信组件':result.authorized?'桌面已就绪':'等待桌面授权',Boolean(result.authorized)&&compatible);
      if(!compatible)get('connect').hidden=true;
      get('folder-status').textContent=!compatible?'请安装完整新版 A4 Note，再重开插件；仅替换 EXE 不够。':result.authorized?'等待论文识别…':'授权后将自动显示文献库文件夹。';
      if(ready&&compatible)await loadFolders();
    }catch(error){if(epoch===connectionEpoch){connected(bridgeError(error),false);get('connect').hidden=true;get('folder-status').textContent='请启动配套桌面软件并重试连接。';}}
  };
  const showTask=task=>{
    const root=get('task-progress');
    const position=root.dataset.captureId===task.captureId?root.querySelector('.progress-files')?.scrollTop||0:0;
    root.replaceChildren(renderTaskProgress(task,frozen,(id,index)=>retry(id,index,task)));
    root.dataset.captureId=task.captureId;
    const files=root.querySelector('.progress-files');if(files)files.scrollTop=position;
    get('progress-view').hidden=false;
  };
  const retry=async(id,index,previous)=>{
    if(sending||!ready||!compatible)return;
    sending=true;sync();
    try{await retryCapture(id,index);completionLabel=null;watch(id,true,previous);status('已重试同一任务；已校验的文件复用，不重复下载。');}
    catch(error){status(bridgeError(error));}
    finally{sending=false;sync();}
  };
  const refreshTasks=async(history=false)=>{
    if(tasksBusy)return null;
    tasksBusy=true;get('tasks').disabled=true;get('progress-refresh').disabled=true;
    const epoch=pollEpoch,id=watchedId;
    try{
      const result=await captureTasks(history?undefined:id);
      if(epoch!==pollEpoch)return null;
      const tasks=Array.isArray(result.tasks)?result.tasks:[];
      get('task-list').replaceChildren(...tasks.map(task=>{
        const box=document.createElement('div');box.append(renderTaskDetails(task));
        if(['needs_user','partial','failed','cancelled'].includes(task.state)){
          const button=document.createElement('button');button.textContent='重试';button.dataset.retry='true';button.addEventListener('click',()=>void retry(task.captureId,undefined,task));box.append(button);
        }return box;
      }));
      if(!tasks.length)get('task-list').textContent='暂无采集任务。';
      const current=tasks.find(task=>task.captureId===id);
      if(current){
        showTask(current);
        if(current.captureId===frozen?.captureId && current.captureId===getEnvelope()?.captureId){
          const r=current.result||{},rows=r.artifacts||[];
          for(const row of get('paper-links').querySelectorAll('[data-artifact-id]')){
            const file=rows.find(a=>a.id===row.dataset.artifactId);
            const label=current.state==='cancelled'?'已取消':current.state==='queued'?'排队中':file?.state==='verified'?(r.libraryImported?'已入库':r.libraryError?'已校验，入库失败':'已校验，等待入库'):file?.state==='needs_user'?'下载失败':!file&&['needs_user','failed'].includes(current.state)?'下载失败':({connecting:'连接中',downloading:'下载中',verifying:'校验中'})[file?.state]||'等待处理';
            row.querySelector('.paper-link-state').textContent=label;
          }
          get('pdf-evidence').textContent=r.libraryImported&&r.library?.hasSourcePdf?'正文 PDF 已入库':r.libraryError==='source_pdf_required'?'正文 PDF 未下载成功':'正文 PDF 状态见上方链接';
        }
      }
      sync();return tasks;
    }catch(error){get('task-list').textContent=bridgeError(error);status(bridgeError(error));return null;}
    finally{tasksBusy=false;get('tasks').disabled=false;get('progress-refresh').disabled=false;}
  };
  const watch=(id=frozen?.captureId,reveal=false,previous)=>{
    if(!id)return;watchedId=id;
    if(reveal){
      // This placeholder is shown only AFTER desktop acceptance, not before.
      // Keep known file rows so the initial scroll has the correct panel height.
      const preview=previous||{captureId:id,title:frozen?.metadata?.title||'采集任务',result:{}};
      const files=preview.result?.artifacts||(id===frozen?.captureId?frozen.artifacts:[])||[];
      // A duplicate acknowledgement may refer to an already completed task;
      // show 'reading status', rather than inventing a new queued/download phase.
      showTask({...preview,state:'checking',result:{artifacts:files.map((file,index)=>({...file,index:file.index??index,state:'checking',error:null,bytesReceived:null,totalBytes:null,byteLength:null}))}});
      revealProgress();
    }
    const epoch=++pollEpoch,deadline=Date.now()+15*60000;
    const step=async()=>{
      if(epoch!==pollEpoch)return;
      const tasks=await refreshTasks();if(epoch!==pollEpoch)return;
      const task=tasks?.find(t=>t.captureId===id);
      if(task&&['complete','needs_user','partial','cancelled','failed'].includes(task.state)){
        const r=task.result||{};
        completionLabel=task.state==='complete'&&r.libraryImported?'已完成':'未完成';
        status(r.libraryImported?(r.library?.hasSourcePdf?'论文与正文 PDF 已在文献库保存。':'论文信息已保存，正文 PDF 待补充；可展开下载帮助。'):'导入尚未完成，请展开进度查看原因。');sync();return;
      }
      if(Date.now()<deadline)setTimeout(()=>void step(),1000);else status('自动刷新已暂停；桌面任务仍可继续，点击进度刷新按钮继续查看。');
    };
    void step();
  };
  get('connect').addEventListener('click',async()=>{
    if(authorizing||sending)return;authorizing=true;sync();
    try{await authorizeNative();await restore();}
    catch(error){status(bridgeError(error));}
    finally{authorizing=false;sync();}
  });
  get('reconnect').addEventListener('click',()=>{if(!authorizing&&!sending){disconnectBridge();void restore();}});
  get('folders-refresh').addEventListener('click',()=>void loadFolders());
  get('tasks').addEventListener('click',()=>void refreshTasks(true));
  get('progress-refresh').addEventListener('click',()=>watch(watchedId));
  get('send').addEventListener('click',async()=>{
    if(get('send').disabled||sending)return;
    if(!frozen)frozen={...structuredClone(getEnvelope()),targetFolderId:tree.value};
    sending=true;sync();
    try{
      const result=await sendCapture(frozen);accepted=true;
      status(`${result.duplicate?'已确认同一任务，不重复提交':'已提交'}。桌面正在下载并导入所选分类；PDF获取失败会单独提示。`);
      get('tasks-panel').open=true;watch(frozen?.captureId,true);
    }catch(error){
      status(`${bridgeError(error)}${['folder_not_found','invalid_target_folder'].includes(error.code)?'':'。未确认是否接收，可重试同一任务或刷新进度。'}`);
      if(['folder_not_found','invalid_target_folder'].includes(error.code)){frozen=null;placeholder('请重新选择分类');await loadFolders();}
    }finally{sending=false;sync();}
  });
  globalThis.addEventListener('pagehide',()=>{++pollEpoch;++folderEpoch;++connectionEpoch;disconnectBridge();},{once:true});
  const unsubscribe=onBridgeDisconnect(error=>{++folderEpoch;loadingFolders=false;connected(['access_required','access_denied'].includes(error.code)?'需要桌面授权':'桌面连接已中断',false);if(!frozen)placeholder('连接恢复后选择文件夹…');get('folder-status').textContent=error.message;});
  globalThis.addEventListener('pagehide',unsubscribe,{once:true});
  void restore();
  return {
    beginScan(){
      if(sending||authorizing||scanning&&getEnvelope())return false;
      cancelProgressReveal();++folderEpoch;++pollEpoch;loadingFolders=false;frozen=null;accepted=false;completionLabel=null;watchedId=null;get('task-progress').replaceChildren();get('progress-view').hidden=true;scanning=true;placeholder('等待识别结果…');sync();return true;
    },
    async scanned(){scanning=false;sync();if(getEnvelope())await loadFolders();},
    async assist(index,work){
      if(!accepted||!frozen||sending)throw new Error('请先选择分类并提交，自动下载失败后再辅助入库');
      sending=true;sync();
      try{await work(frozen,index,status);get('tasks-panel').open=true;watch(frozen?.captureId,true);}
      finally{sending=false;sync();}
    }
  };
}

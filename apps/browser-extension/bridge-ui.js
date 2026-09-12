import {nativeHello,authorizeNative,sendCapture,captureTasks,captureFolders,disconnectBridge,bridgeError} from './bridge.mjs';

export function setupBridge(getEnvelope,status){
  const get=id=>document.getElementById(id);
  let ready=false,compatible=false,sending=false,authorizing=false,loadingFolders=false,accepted=false;
  let connectionEpoch=0,folderEpoch=0,pollEpoch=0,frozen=null,scanning=true,tasksBusy=false;
  const select=get('folder-select');
  const sync=()=>{
    get('send').disabled=!ready||!compatible||scanning||loadingFolders||sending||accepted||!getEnvelope()||(!frozen&&!select.value);
    get('send').textContent=sending?'正在处理…':accepted?'已提交，查看下方进度':frozen?'重试同一导入任务':'下载并导入文献库';
    select.disabled=!ready||!compatible||loadingFolders||sending||Boolean(frozen);
    get('folders-refresh').disabled=!ready||!compatible||loadingFolders||sending||Boolean(frozen);
    get('scan').disabled=scanning||sending||authorizing;
    get('connect').disabled=authorizing||sending;
    get('reconnect').disabled=authorizing||sending;
    for(const button of document.querySelectorAll('[data-assist]'))button.disabled=!accepted||sending||!ready||!compatible;
  };
  const placeholder=text=>{const option=document.createElement('option');option.value='';option.textContent=text;select.replaceChildren(option);select.value='';};
  const connected=(message,ok)=>{
    ready=ok;get('connection-status').textContent=message;get('connection-status').dataset.connected=String(ok);
    get('connect').hidden=ok;sync();
  };
  const showFolders=rows=>{
    if(!Array.isArray(rows)||rows.length>2000)throw new Error('分类列表无效，请更新桌面软件');
    const byId=new Map();
    for(const row of rows){
      if(typeof row.id!=='string'||!row.id||typeof row.name!=='string'||byId.has(row.id))throw new Error('分类列表格式不正确');
      byId.set(row.id,row);
    }
    const previous=select.value;
    placeholder('请选择导入分类');
    const entries=rows.map(row=>{
      let cursor=row;const parts=[],seen=new Set();let valid=true;
      while(cursor){
        if(seen.has(cursor.id)||parts.length>=64){valid=false;break;}
        seen.add(cursor.id);parts.unshift(cursor.name);
        if(!cursor.parentId)break;
        cursor=byId.get(cursor.parentId);if(!cursor){valid=false;break;}
      }
      return {row,label:parts.join(' / '),valid};
    }).sort((a,b)=>a.label.localeCompare(b.label,'zh-CN'));
    for(const {row,label,valid} of entries){
      const option=document.createElement('option');option.value=row.id;option.textContent=valid?label:`[层级异常] ${label}`;option.disabled=!valid;select.append(option);
    }
    select.value=entries.some(e=>e.valid&&e.row.id===previous)?previous:'';
    get('folder-status').textContent=rows.length?'请选择目标分类；在桌面新建分类后可点击刷新。':'文献库暂无分类，请先在桌面创建。';
  };
  const loadFolders=async()=>{
    if(!getEnvelope()||!ready||!compatible||frozen)return;
    const epoch=++folderEpoch,source=getEnvelope();loadingFolders=true;sync();get('folder-status').textContent='正在读取桌面分类…';
    try{
      const result=await captureFolders();
      if(epoch!==folderEpoch||source!==getEnvelope())return;
      showFolders(result.folders);
    }catch(error){
      if(epoch!==folderEpoch)return;
      placeholder('分类读取失败');get('folder-status').textContent=bridgeError(error);
    }finally{if(epoch===folderEpoch){loadingFolders=false;sync();}}
  };
  const restore=async()=>{
    const epoch=++connectionEpoch;++folderEpoch;loadingFolders=false;
    compatible=false;connected('正在连接 A4 Note…',false);get('connect').hidden=true;
    try{
      const result=await nativeHello();if(epoch!==connectionEpoch)return;
      compatible=result.capabilities?.folderSelection===true;
      connected(!compatible?'桌面或通信组件版本较旧，请安装配套0.5.0版本':result.authorized?'已连接 A4 Note':'首次使用，请点击连接并在桌面授权',Boolean(result.authorized));
      if(!compatible)get('connect').hidden=true;
      get('folder-status').textContent=!compatible?'需更新配套桌面安装器后才能选择分类。':result.authorized?'等待论文识别…':'授权后将自动显示文献库文件夹。';
      if(ready&&compatible)await loadFolders();
    }catch(error){if(epoch===connectionEpoch){connected(bridgeError(error),false);get('connect').hidden=true;get('folder-status').textContent='请启动配套桌面软件并重试连接。';}}
  };
  const refreshTasks=async()=>{
    if(tasksBusy)return null;
    tasksBusy=true;get('tasks').disabled=true;
    try{
      const result=await captureTasks();
      const labels={queued:'排队中',downloading:'下载中',browser_uploading:'浏览器传输中',complete:'文件已校验',needs_user:'需要处理',partial:'部分完成',cancelled:'已取消',failed:'失败'};
      const tasks=Array.isArray(result.tasks)?result.tasks:[];
      get('task-list').replaceChildren(...tasks.map(task=>{
        const p=document.createElement('p'),r=task.result||{},library=r.library||{};
        const errors=(r.artifacts||[]).filter(a=>a.error).map(a=>a.error).join('；');
        const libraryError=r.libraryError==='folder_not_found'?'所选分类已被删除，请重新识别并选择有效分类':r.libraryError;
        const imported=r.libraryImported?(library.hasSourcePdf?'已入文献库（含正文PDF）':'已保存论文信息，正文PDF仍待补充'):'待入库';
        const folder=library.folderName?` · 分类：${library.folderName}`:'';
        const duplicate=library.created===false?' · 已有关联文献，保留原分类':'';
        p.textContent=`${task.title||'未命名'} — ${labels[task.state]||task.state} / ${imported}${folder}${duplicate}${libraryError?`；${libraryError}`:''}${errors?`；${errors}`:''}`;
        return p;
      }));
      if(!tasks.length)get('task-list').textContent='暂无采集任务。';
      return tasks;
    }catch(error){get('task-list').textContent=bridgeError(error);return null;}
    finally{tasksBusy=false;get('tasks').disabled=false;}
  };
  const watch=()=>{
    const epoch=++pollEpoch,id=frozen?.captureId,deadline=Date.now()+120000;
    const step=async()=>{
      if(epoch!==pollEpoch)return;
      const tasks=await refreshTasks();if(epoch!==pollEpoch)return;
      const task=tasks?.find(t=>t.captureId===id);
      if(task&&['complete','needs_user','partial','cancelled','failed'].includes(task.state))return;
      if(Date.now()<deadline)setTimeout(()=>void step(),1500);
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
  select.addEventListener('change',sync);
  get('tasks').addEventListener('click',()=>void refreshTasks());
  get('send').addEventListener('click',async()=>{
    if(get('send').disabled||sending)return;
    if(!frozen)frozen={...structuredClone(getEnvelope()),targetFolderId:select.value};
    sending=true;sync();
    try{
      const result=await sendCapture(frozen);accepted=true;
      status(`${result.duplicate?'已确认同一任务，不重复提交':'已提交'}。桌面正在下载并导入所选分类；PDF获取失败会单独提示。`);
      get('tasks-panel').open=true;watch();
    }catch(error){
      status(`${bridgeError(error)}${['folder_not_found','invalid_target_folder'].includes(error.code)?'':'。未确认是否接收，可重试同一任务或刷新进度。'}`);
      if(['folder_not_found','invalid_target_folder'].includes(error.code)){frozen=null;placeholder('请重新选择分类');await loadFolders();}
    }finally{sending=false;sync();}
  });
  globalThis.addEventListener('pagehide',()=>{++pollEpoch;++folderEpoch;++connectionEpoch;disconnectBridge();},{once:true});
  void restore();
  return {
    beginScan(){
      if(sending||authorizing||scanning&&getEnvelope())return false;
      ++folderEpoch;++pollEpoch;loadingFolders=false;frozen=null;accepted=false;scanning=true;placeholder('等待识别结果…');sync();return true;
    },
    async scanned(){scanning=false;sync();if(getEnvelope())await loadFolders();},
    async assist(index,work){
      if(!accepted||!frozen||sending)throw new Error('请先选择分类并提交，自动下载失败后再辅助入库');
      sending=true;sync();
      try{await work(frozen,index,status);get('tasks-panel').open=true;watch();}
      finally{sending=false;sync();}
    }
  };
}

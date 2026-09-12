import {useEffect,useRef,useState} from 'react';
import {captureSupported,disableCaptureBridge,getCaptureStatus,revealCaptureInbox,updateCaptureTask,setCaptureEnrichment,type CaptureBridgeStatus} from '../../platform/capture';
import {Button,Panel} from '../../shared/ui';
const labels:Record<string,string>={queued:'排队',downloading:'下载中',browser_uploading:'浏览器传输中',complete:'文件已校验',needs_user:'需处理',partial:'部分完成',cancelled:'已取消',failed:'失败'};
export function CaptureSettings(){
  const [bridge,setBridge]=useState<CaptureBridgeStatus|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const mounted=useRef(true),pending=useRef(false);
  useEffect(()=>{mounted.current=true;
    const refresh=()=>{if(captureSupported()&&!pending.current)void getCaptureStatus().then(s=>{if(mounted.current)setBridge(s);}).catch(e=>{if(mounted.current)setMessage(String(e));});};
    refresh();const timer=setInterval(refresh,3000);return()=>{mounted.current=false;clearInterval(timer);};
  },[]);
  const run=async(work:()=>Promise<unknown>)=>{if(pending.current)return;pending.current=true;setBusy(true);setMessage('');
    try{await work();const next=await getCaptureStatus();if(mounted.current)setBridge(next);}catch(e){if(mounted.current)setMessage(String(e));}
    finally{pending.current=false;if(mounted.current)setBusy(false);}
  };
  return <Panel title="浏览器论文采集 · 原生通信">
    <p>无需链接、端口、扩展ID或配对码。安装通信组件后，在扩展点击连接，并在桌面允许一次；授权会保存在本机，重启后自动恢复。</p>
    {!captureSupported()?<p>请在Windows桌面软件中使用。</p>:<>
      <p>状态：{bridge?.enabled?'已授权，可自动连接':'尚未授权或已暂停，请在扩展点击连接'}。</p>
      {bridge?.error&&<p role="alert">{bridge.error}</p>}
      <label><input type="checkbox" style={{width:14,height:14}} disabled={busy||!bridge||!!bridge.error} checked={bridge?.enrichMetadata??true} onChange={e=>{const value=e.target.checked;void run(()=>setCaptureEnrichment(value));}} />通过 Crossref / Europe PMC 补全信息（会发送 DOI / PMCID）</label>
      <div><Button disabled={busy||!bridge?.enabled} onClick={()=>void run(disableCaptureBridge)}>撤销浏览器授权</Button>{' '}
        <Button disabled={busy} onClick={()=>void run(async()=>{})}>刷新任务</Button>{' '}
        <Button disabled={busy||!!bridge?.error} onClick={()=>void run(revealCaptureInbox)}>打开采集目录</Button></div>
      <p className="settings-muted">请使用包含原生通信组件的新安装包，裸EXE不会注册浏览器连接。已入库信息和PDF随资料库备份；未完成队列暂存目录仍需单独备份。显示最近100条任务。</p>
      <p role="status">{message}</p>
      {bridge?.inbox.tasks.map(task=><div key={task.captureId} className="plugin-setting-row"><span><strong>{task.title||'未命名论文'}</strong><small>{labels[task.state]||task.state} · {task.result.libraryImported?(task.result.library?.hasSourcePdf?'已入文献库':'元数据已入库，缺正文'):'尚未入库'}</small>{task.result.libraryError&&<small>{task.result.libraryError}</small>}{task.result.error&&<small>{task.result.error}</small>}{task.result.artifacts?.filter(a=>a.error).map(a=><small key={a.id}>{a.id}: {a.error}</small>)}</span>
        {['partial','needs_user','failed','cancelled'].includes(task.state)&&<Button disabled={busy} onClick={()=>void run(()=>updateCaptureTask(task.captureId,'retry'))}>重试</Button>}
        {['queued','downloading','browser_uploading'].includes(task.state)&&<Button disabled={busy} onClick={()=>void run(()=>updateCaptureTask(task.captureId,'cancel'))}>取消</Button>}</div>)}
    </>}
  </Panel>;
}

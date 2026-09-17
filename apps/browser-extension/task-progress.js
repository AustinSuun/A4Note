// Main view: filenames, real progress bars, state icons and explicit retry only.
const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const active=new Set(['checking','queued','connecting','downloading','verifying','browser_uploading']);
const terminal=new Set(['complete','needs_user','partial','failed','cancelled']);
const states={checking:'读取任务状态',queued:'排队',connecting:'连接',downloading:'下载',verifying:'校验',verified:'已校验',needs_user:'失败',partial:'部分失败',failed:'失败',cancelled:'已取消',browser_uploading:'浏览器传输'};
export function errorText(code){
  if(String(code).startsWith('system_proxy_'))return `系统代理：${errorText(String(code).slice(13))}`;
  return ({source_pdf_required:'正文 PDF 未获取成功，未新增文献。',network_connection_reset:'连接被重置',network_connection_refused:'连接被拒绝，请检查代理程序是否运行',network_connect_failed:'连接失败，请检查网络或代理',network_or_tls_error:'网络或 TLS 连接失败',download_timeout:'下载超时',incomplete_download:'收到的文件长度不完整',attachment_is_html_or_login_page:'返回的是网页或登录页，不是附件',attachment_type_mismatch:'附件类型与内容不符',unsupported_supplement_format:'无法确定受支持的附件格式',executable_attachment_rejected:'不下载可执行文件',file_or_disk_limit_exceeded:'超过单文件或存储限额',login_or_permission_required:'网站要求登录或访问权限',not_retried:'本次未重试此文件',folder_not_found:'保存文件夹已被删除，请重新识别并选择'})[code]||String(code||'');
}
function bar(value,max,label){const p=node('progress','file-progress');p.max=max||1;if(Number.isFinite(value))p.value=Math.max(0,Math.min(max||1,value));p.setAttribute('aria-label',label);return p;}
export function renderTaskProgress(task,envelope,onRetry){
  const card=node('section','capture-progress');card.setAttribute('aria-label',task.title||'采集进度');
  const result=task.result||{};
  const fallback=envelope?.captureId===task.captureId?envelope.artifacts:[];
  let rows=Array.isArray(result.artifacts)?result.artifacts:fallback.map((a,index)=>({...a,index,state:'queued'}));
  if(task.state==='queued'||task.state==='downloading'&&!result.phase)rows=rows.map(a=>({...a,state:'queued',error:null,bytesReceived:0,totalBytes:null}));
  if(terminal.has(task.state))rows=rows.map(a=>active.has(a.state)?{...a,state:task.state==='cancelled'?'cancelled':'needs_user',error:result.error||'download_failed'}:a);
  if(envelope?.captureId!==task.captureId)card.append(node('h2','progress-task-title',task.title||'采集任务'));
  const done=rows.filter(a=>a.state==='verified').length;
  const allSaved=task.state==='complete'&&result.libraryImported&&result.library?.hasSourcePdf;
  const failed=terminal.has(task.state)&&!allSaved;
  card.dataset.state=allSaved?'complete':failed?'failed':task.state;
  const heading=node('div','progress-heading');
  const icon=node('span',`progress-icon ${allSaved?'ok':failed?'bad':'working'}`,allSaved?'✓':failed?'!':'◌');
  icon.title=allSaved?'已保存正文与全部附件':failed?'下载或入库未全部完成，详细原因见帮助':result.phase==='importing'?'文件已校验，正在入库':'正在处理';icon.setAttribute('aria-label',icon.title);
  heading.append(icon,bar(rows.length?done:terminal.has(task.state)?0:undefined,rows.length,`文件校验完成 ${done}/${rows.length}；${icon.title}`),node('span','progress-number',`${done}/${rows.length}`));
  const retry=(index,label)=>{const b=node('button','progress-retry','↻');b.type='button';b.dataset.retry='true';b.title=label;b.setAttribute('aria-label',label);b.addEventListener('click',()=>onRetry(task.captureId,index));return b;};
  if(failed)heading.append(retry(undefined,'重试未完成的下载或入库'));
  card.append(heading);
  const files=node('div','progress-files');
  rows.forEach((a,i)=>{
    const index=Number.isInteger(a.index)?a.index:i;
    const source=fallback.find(x=>x.id===a.id);
    const label=a.label||source?.label||`${a.role==='fulltext'?'正文 PDF':'附件'} ${i+1}`;
    const state=states[a.state]||a.state;
    const row=node('div','progress-file');row.dataset.state=a.state||'';
    const top=node('div','progress-file-top');const name=node('span','progress-file-name',label);name.title=label;top.append(name);
    const total=Number(a.totalBytes??a.byteLength),received=Number(a.bytesReceived??a.byteLength??0);
    const known=Number.isFinite(total)&&total>0;
    const fraction=a.state==='verified'?1:known?Math.max(0,Math.min(1,received/total)):undefined;
    const text=a.state==='verified'?'✓':a.error||a.state==='needs_user'?'!':known?`${Math.floor((fraction||0)*100)}%`:'—';
    const stat=node('span','progress-file-state',text);stat.title=state;stat.setAttribute('aria-label',state);top.append(stat);
    if(a.state==='needs_user'&&terminal.has(task.state))top.append(retry(index,`重试 ${label}`));
    row.append(top,bar(fraction===undefined&& !active.has(a.state)?0:fraction,1,`${label}：${state}${known?`，${received}/${total} 字节`:''}`));files.append(row);
  });
  card.append(files);return card;
}
export function renderTaskDetails(task){
  const p=node('p');const r=task.result||{};
  const errors=[r.error,r.libraryError,...(r.artifacts||[]).map(a=>a.error)].filter(Boolean).map(errorText);
  p.textContent=`${task.title||'未命名'} · ${states[task.state]||task.state} · ${r.libraryImported?(r.library?.hasSourcePdf?'正文已入库':'已有文献关联'):'本轮未入库'}${errors.length?'；'+[...new Set(errors)].join('；'):''}`;
  return p;
}

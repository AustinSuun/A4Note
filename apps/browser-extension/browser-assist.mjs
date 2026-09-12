import { sendCapture, captureTasks, uploadPdf } from './bridge.mjs';
export async function browserAssist(envelope,index,status){
  const artifact=envelope.artifacts[index];const url=new URL(artifact.url);
  if(url.protocol!=='https:' || (url.port && url.port!=='443') || url.username || url.password)throw new Error('辅助传输仅支持 HTTPS/443 PDF');
  // Called directly from the click handler: permission prompt retains the user gesture.
  if(!await chrome.permissions.request({origins:[`${url.origin}/*`]}))throw new Error('未授权此论文站点；仍可手动下载并在文献详情补充PDF');
  await sendCapture(envelope);
  const task=(await captureTasks()).tasks.find(t=>t.captureId===envelope.captureId);
  if(!task || !['needs_user','failed','partial'].includes(task.state))throw new Error('请等待桌面自动下载结束；失败后再点辅助入库。已完成的文件无需重复上传。');
  status('正在使用浏览器网络与已有登录态获取PDF。请保持此弹窗打开；不会读取或传送Cookie内容。');
  const response=await fetch(url.href,{credentials:'include',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(60000)});
  if(!response.ok || !response.body)throw new Error(`浏览器下载失败 HTTP ${response.status}；请用浏览器下载按钮后手动补充`);
  const reader=response.body.getReader();const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>50*1024*1024)throw new Error('PDF超过50MiB限制');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const blob=new Blob(chunks,{type:'application/pdf'});
  if(await blob.slice(0,5).text()!=='%PDF-')throw new Error('返回内容不是PDF，可能是登录页或验证码；请在浏览器中下载后手动补充');
  status('PDF正在发送到桌面验证并排队入库，请保持弹窗打开。');
  await uploadPdf(envelope.captureId,index,blob);
  status('桌面已校验PDF并重新排队；将自动补入同一篇文献，不替换已有主PDF或标注。请刷新任务确认入库结果。');
}

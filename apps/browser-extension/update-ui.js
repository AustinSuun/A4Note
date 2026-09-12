import {fetchExtensionUpdate,RELEASE_PAGE} from './extension-updates.mjs';
const get=id=>document.getElementById(id);
const current=chrome.runtime.getManifest().version;
get('extension-version').textContent=`当前插件 ${current}`;
let update=null,busy=false;
get('check-extension-update').addEventListener('click',async()=>{
  if(busy)return;busy=true;update=null;get('download-extension-update').hidden=true;get('check-extension-update').disabled=true;
  get('extension-update-status').textContent='正在检查官方发布…';
  try{
    // Ask only for the API origin, and only from this explicit click (existing optional permissions cover it).
    if(!await chrome.permissions.request({origins:['https://api.github.com/*']}))throw new Error('未允许访问更新服务；论文采集不受影响');
    update=await fetchExtensionUpdate(current);
    get('extension-update-status').textContent=update.available?`发现插件 ${update.version}（配套桌面 ${update.desktopVersion}）。下载后仍需手动重新加载。`:`当前插件 ${current} 已是该通道最新或更新的版本。`;
    get('download-extension-update').hidden=!update.available;
  }catch(error){get('extension-update-status').textContent=error.name==='TimeoutError'?'更新检查超时，请稍后重试':String(error.message||'无法检查更新');}
  finally{busy=false;get('check-extension-update').disabled=false;}
});
get('download-extension-update').addEventListener('click',async()=>{
  if(!update?.available||busy)return;busy=true;get('download-extension-update').disabled=true;get('check-extension-update').disabled=true;
  try{await chrome.downloads.download({url:update.url,filename:update.filename,saveAs:true,conflictAction:'uniquify'});get('extension-update-status').textContent='新版插件包已交给浏览器下载，并未完成安装。请核对下载完成后，按下方步骤更新。';get('extension-update-help').open=true;}
  catch(error){get('extension-update-status').textContent=`下载未启动：${error.message}`;}
  finally{busy=false;get('download-extension-update').disabled=false;get('check-extension-update').disabled=false;}
});
get('extension-release-page').href=RELEASE_PAGE;

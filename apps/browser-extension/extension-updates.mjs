// Explicit, user-initiated update discovery. No remotely loaded code or self-replacement.
export const RELEASE_API='https://api.github.com/repos/AustinSuun/A4Note/releases/latest';
export const RELEASE_PAGE='https://github.com/AustinSuun/A4Note/releases/latest';
export function compareVersions(a,b){
  const parse=value=>{if(typeof value!=='string'||!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value))throw new Error('更新版本格式无效');const parts=value.split('.').map(Number);if(parts.some(n=>n>65535))throw new Error('更新版本超出范围');return parts;};
  const x=parse(a),y=parse(b);for(let i=0;i<4;i++){const d=(x[i]||0)-(y[i]||0);if(d)return Math.sign(d);}return 0;
}
export function selectExtensionUpdate(release,current){
  compareVersions(current,current);
  if(!release || release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets))throw new Error('官方发布信息暂不可用，请稍后重试');
  const candidates=[];
  for(const asset of release.assets){
    const match=/^A4-Note-Capture-(\d+\.\d+\.\d+)\.zip$/.exec(asset.name||'');if(!match)continue;
    const expected=`https://github.com/AustinSuun/A4Note/releases/download/${release.tag_name}/${asset.name}`;
    if(asset.browser_download_url!==expected || asset.state!=='uploaded' || !Number.isSafeInteger(asset.size) || asset.size<1 || asset.size>10*1024*1024)throw new Error('插件下载地址或文件信息无效');
    compareVersions(match[1],current);candidates.push({version:match[1],url:expected,filename:asset.name,desktopVersion:release.tag_name.slice(1)});
  }
  if(!candidates.length)throw new Error('最新发布尚无配套插件包，请稍后再试');
  candidates.sort((a,b)=>compareVersions(b.version,a.version));const latest=candidates[0];return {...latest,available:compareVersions(latest.version,current)>0};
}
export async function fetchExtensionUpdate(current,fetcher=fetch){
  const response=await fetcher(RELEASE_API,{headers:{Accept:'application/vnd.github+json'},credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(response.status===403||response.status===429?'GitHub检查暂受限，请稍后重试':`更新检查失败（HTTP ${response.status}）`);
  const reader=response.body.getReader();let length=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>512*1024)throw new Error('发布信息过大');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
  return selectExtensionUpdate(JSON.parse(new TextDecoder().decode(bytes)),current);
}

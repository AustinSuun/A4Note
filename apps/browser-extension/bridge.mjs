import {NativeMessenger} from './native-bridge.mjs';
const native=new NativeMessenger();
export const nativeHello=async()=>{try{return await native.request('hello');}catch(e){if(e.code!=='desktop_unavailable')throw e;return native.request('hello');}};
const connectedRequest=async(operation,payload={})=>{await nativeHello();return native.request(operation,payload);};
export const authorizeNative=()=>native.request('request_access');
const folderRequest=async(operation,payload={})=>{
  const hello=await nativeHello();
  if(hello.capabilities?.folderSelection!==true){
    const error=new Error('请更新配套桌面安装器，旧版本不支持分类导入');
    error.code='folder_selection_unsupported';throw error;
  }
  return native.request(operation,payload);
};
export const sendCapture=envelope=>Object.hasOwn(envelope,'targetFolderId')?folderRequest('submit',envelope):connectedRequest('submit',envelope);
export const captureFolders=()=>folderRequest('list_folders');
export const captureTasks=()=>connectedRequest('list_tasks');
export const disconnectBridge=()=>native.close();
export const bridgeError=error=>String(error?.message||'无法连接A4 Note，请检查桌面软件与通信组件');
export async function uploadPdf(captureId,index,blob){
  if(!/^[0-9a-f-]{36}$/.test(captureId)||!Number.isInteger(index)||index<0||index>=100||blob.size<8||blob.size>50*1024*1024)throw new Error('PDF上传参数无效');
  const {transferId}=await connectedRequest('pdf_begin',{captureId,index,byteLength:blob.size});
  try{
    let sequence=0;
    for(let offset=0;offset<blob.size;offset+=192*1024){
      const bytes=new Uint8Array(await blob.slice(offset,offset+192*1024).arrayBuffer());let binary='';
      for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      await native.request('pdf_chunk',{transferId,sequence:sequence++,data:btoa(binary)});
    }
    return await native.request('pdf_finish',{transferId},90000);
  }catch(error){await native.request('pdf_abort',{},5000).catch(()=>{});throw error;}
}

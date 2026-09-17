import {NativeMessenger} from './native-bridge.mjs';
const native=new NativeMessenger();
export const onBridgeDisconnect=listener=>native.subscribeDisconnect(listener);
export const supportsFolders=hello=>hello.capabilities?.folderSelection===true && hello.nativeHost?.capabilities?.folderSelection===true;
export const supportsCaptureFlow=hello=>supportsFolders(hello)&&hello.capabilities?.captureProgress===true&&hello.capabilities?.supplementFiles===true&&hello.capabilities?.sourcePdfRequired===true&&hello.capabilities?.captureRetry===true&&hello.nativeHost?.capabilities?.captureRetry===true;
export const nativeHello=async()=>{try{return await native.request('hello');}catch(e){if(e.code!=='desktop_unavailable')throw e;return native.request('hello');}};
const connectedRequest=async(operation,payload={})=>{await nativeHello();return native.request(operation,payload);};
export const authorizeNative=()=>native.request('request_access');
const folderRequest=async(operation,payload={})=>{
  const hello=await nativeHello();
  if(!supportsFolders(hello)){
    const error=new Error('通信组件或桌面版本较旧，请安装完整新版 A4 Note 后重开插件');
    error.code='folder_selection_unsupported';throw error;
  }
  return native.request(operation,payload);
};
export const sendCapture=async envelope=>{const hello=await nativeHello();if(!supportsCaptureFlow(hello))throw new Error('需要配套新版桌面与通信组件，避免旧版仅保存论文信息');return Object.hasOwn(envelope,'targetFolderId')?folderRequest('submit',envelope):connectedRequest('submit',envelope);};
export const captureFolders=()=>folderRequest('list_folders');
export const captureTasks=captureId=>connectedRequest('list_tasks',captureId?{captureId}:{});
export const retryCapture=async(captureId,index)=>{const hello=await nativeHello();if(!supportsCaptureFlow(hello))throw new Error('需要配套新版桌面与通信组件');return native.request('retry_capture',{captureId,...(index===undefined?{}:{index})});};
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

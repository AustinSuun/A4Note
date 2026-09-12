/** Native Messaging transport. No HTTP discovery, ports, pairing codes or web fallback. */
export const NATIVE_HOST = 'app.aster.research.capture';
const operations=new Set(['hello','request_access','submit','list_tasks','list_folders','pdf_begin','pdf_chunk','pdf_finish','pdf_abort']);
export class NativeMessenger {
  constructor(connect=()=>chrome.runtime.connectNative(NATIVE_HOST),lastError=()=>globalThis.chrome?.runtime?.lastError?.message){
    this.connect=connect;this.lastError=lastError;this.port=null;this.pending=new Map();this.sequence=0;this.detach=null;
  }
  ensurePort(){
    if(this.port)return this.port;
    const port=this.connect();this.port=port;
    const message=value=>{
      if(this.port!==port)return;
      const request=this.pending.get(value?.id);if(!request)return;
      if(typeof value.ok!=='boolean'){this.close('原生通信响应格式不正确，请更新桌面软件');return;}
      this.pending.delete(value.id);clearTimeout(request.timer);
      if(value.ok)request.resolve(value.result);
      else{const error=new Error(typeof value.error?.message==='string'?value.error.message:'桌面端未完成请求');error.code=value.error?.code||'native_request_failed';request.reject(error);}
    };
    const disconnected=()=>{
      const detail=this.lastError()||''; // Read inside callback to consume Chromium lastError.
      if(this.port!==port)return;
      this.close(/not found|not registered|specified native messaging host/i.test(detail)?'未安装浏览器通信组件，请安装或修复新版 A4 Note':'原生连接已断开，请确认 A4 Note 已启动');
    };
    port.onMessage.addListener(message);port.onDisconnect.addListener(disconnected);
    this.detach=()=>{port.onMessage.removeListener(message);port.onDisconnect.removeListener(disconnected);};
    return port;
  }
  request(operation,payload={},timeoutMs=operation==='request_access'?180000:30000){
    if(!operations.has(operation))return Promise.reject(new Error('不支持的原生操作'));
    if(this.pending.size>=8)return Promise.reject(new Error('请求过多，请稍后重试'));
    if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>300000)return Promise.reject(new Error('无效的等待时间'));
    let id;do{id=this.sequence=this.sequence%0xffffffff+1;}while(this.pending.has(id));
    const message={id,operation,payload};
    try{if(new TextEncoder().encode(JSON.stringify(message)).length>1024*1024-4096)return Promise.reject(new Error('元数据消息过大，请缩小采集范围'));}catch{return Promise.reject(new Error('无法编码采集消息'));}
    return new Promise((resolve,reject)=>{
      let port;try{port=this.ensurePort();}catch{reject(new Error('无法启动原生通信组件，请修复 A4 Note 安装'));return;}
      const timer=setTimeout(()=>{this.close(operation==='request_access'?'等待授权超时，请重试并在桌面确认':'桌面响应超时，请检查 A4 Note 状态');},timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try{port.postMessage(message);}catch{this.close('无法发送原生消息，请重新连接 A4 Note');}
    });
  }
  close(reason='原生连接已关闭'){
    const port=this.port;this.port=null;
    this.detach?.();this.detach=null;
    for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(new Error(reason));}
    this.pending.clear();try{port?.disconnect();}catch{}
  }
}

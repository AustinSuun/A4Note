//! Native authorization and queue adapter. No browser-supplied paths or HTTP fallback.
use super::*;
use super::native_protocol::{Operation,Request};
pub(super) struct NativeState {
    pub service:Arc<Service>,pub gate:Mutex<()>,
    pub authorize:Arc<dyn Fn()->bool+Send+Sync>,
    prompting:AtomicBool,last_prompt:Mutex<Option<Instant>>,
}
pub(super) struct Session {pub upload:Option<super::native_upload::Upload>}
impl NativeState {
    pub fn new(service:Arc<Service>,authorize:Arc<dyn Fn()->bool+Send+Sync>)->Self{Self{service,gate:Mutex::new(()),authorize,prompting:AtomicBool::new(false),last_prompt:Mutex::new(None)}}
    pub fn allowed(&self)->bool{self.service.enabled.load(Ordering::Acquire)&&!self.service.terminating.load(Ordering::Acquire)}
    pub fn revoke(&self)->Result<(),String>{let _gate=self.gate.lock().map_err(|_|"native_lock")?;self.service.enabled.store(false,Ordering::Release);self.service.generation.fetch_add(1,Ordering::AcqRel);self.service.store.set_native_setting("authorized",false)}
    pub fn request_access(&self)->Result<Value,String>{
        if self.allowed(){return Ok(json!({"authorized":true}));}
        if self.prompting.swap(true,Ordering::AcqRel){return Err("授权窗口已打开，请在桌面确认".into());}
        struct Reset<'a>(&'a AtomicBool);impl Drop for Reset<'_>{fn drop(&mut self){self.0.store(false,Ordering::Release);}}
        let _reset=Reset(&self.prompting);
        {let mut last=self.last_prompt.lock().map_err(|_|"native_lock")?;if last.is_some_and(|t|t.elapsed()<Duration::from_secs(10)){return Err("请稍后再申请授权".into());}*last=Some(Instant::now());}
        let generation=self.service.generation.load(Ordering::Acquire);
        if !(self.authorize)(){return Err("access_denied".into());}
        let _gate=self.gate.lock().map_err(|_|"native_lock")?;
        if self.service.terminating.load(Ordering::Acquire)||generation!=self.service.generation.load(Ordering::Acquire){return Err("授权请求已撤销，请重试".into());}
        self.service.store.set_native_setting("authorized",true)?;
        self.service.enabled.store(true,Ordering::Release);Ok(json!({"authorized":true}))
    }
    pub fn dispatch(&self,request:Request,session:&mut Session)->Value{
        let result=(||->Result<Value,String>{
            if request.operation==Operation::Hello{return Ok(json!({"protocolVersion":1,"authorized":self.allowed(),"transport":"native_messaging","version":"0.6.0","capabilities":{"folderSelection":true}}));}
            if request.operation==Operation::RequestAccess{return self.request_access();}
            if request.operation==Operation::PdfFinish{
                if !self.allowed(){session.upload=None;return Err("access_required".into());}
                let upload=session.upload.take().ok_or("missing_pdf_transfer")?;
                return upload.finish(self,&request.payload);
            }
            let _gate=self.gate.lock().map_err(|_|"native_lock")?;
            if !self.allowed(){session.upload=None;return Err("access_required".into());}
            match request.operation{
                Operation::Submit=>{
                    model::validate(&request.payload)?;
                    let selection = super::folders::validate_selection(&self.service.library_root,&request.payload);
                    self.service.store.submit_validated(&request.payload,selection)
                },
                Operation::ListFolders=>super::folders::list(&self.service.library_root),
                Operation::ListTasks=>self.service.store.list(),
                Operation::PdfBegin=>{if session.upload.is_some(){return Err("已有文件正在传输".into());}let upload=super::native_upload::Upload::begin(self.service.clone(),&request.payload)?;let result=json!({"transferId":upload.transfer_id});session.upload=Some(upload);Ok(result)},
                Operation::PdfChunk=>session.upload.as_mut().ok_or("missing_pdf_transfer")?.chunk(&request.payload),
                Operation::PdfAbort=>{session.upload=None;Ok(json!({"aborted":true}))},
                _=>Err("unsupported_native_operation".into()),
            }
        })();
        match result{Ok(value)=>json!({"id":request.id,"ok":true,"result":value}),Err(error)=>{
            let message=match error.as_str(){"folder_not_found"=>"所选分类已不存在，请刷新文件夹并重新选择","invalid_target_folder"=>"请选择有效的文献库分类文件夹","access_required"=>"尚未授权或授权已撤销，请点击连接并在桌面确认","access_denied"=>"你已拒绝授权，未接收采集内容",_=>&error};
            json!({"id":request.id,"ok":false,"error":{"code":error,"message":message}})
        }}
    }
}

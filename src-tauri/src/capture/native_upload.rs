//! One bounded, connection-owned PDF transfer. Drop releases its task and temporary file.
use super::*;
use base64::{Engine,engine::general_purpose::STANDARD};
use std::{fs,io::Write};
static UPLOAD_GATE:OnceLock<Arc<tokio::sync::Semaphore>>=OnceLock::new();
pub(super) struct Upload {
    service:Arc<Service>,pub transfer_id:String,id:String,index:usize,path:PathBuf,
    file:Option<fs::File>,expected:u64,written:u64,sequence:u64,generation:u64,started:Instant,
    _permit:tokio::sync::OwnedSemaphorePermit,
}
impl Upload{
    pub fn begin(service:Arc<Service>,value:&Value)->Result<Self,String>{
        let id=value["captureId"].as_str().ok_or("missing_capture_id")?.to_string();
        if Uuid::parse_str(&id).map(|v|v.to_string()!=id).unwrap_or(true){return Err("invalid_capture_id".into());}
        let index=value["index"].as_u64().filter(|n|*n<100).ok_or("invalid_artifact_index")? as usize;
        let expected=value["byteLength"].as_u64().filter(|n|*n>=8&&*n<=download::FILE_LIMIT).ok_or("PDF必须小于50MiB")?;
        let permit=UPLOAD_GATE.get_or_init(||Arc::new(tokio::sync::Semaphore::new(1))).clone().try_acquire_owned().map_err(|_|"已有PDF正在传输，请稍后重试")?;
        let dir=service.root.join("items").join(&id);fs::create_dir_all(&dir).map_err(|_|"upload_directory")?;
        if !dir.canonicalize().map_err(|_|"upload_directory")?.starts_with(service.root.canonicalize().map_err(|_|"upload_directory")?){return Err("upload_directory_escape".into());}
        if download::directory_size(&service.root)?.saturating_add(expected)>1024*1024*1024{return Err("capture_disk_quota_1gib".into());}
        let transfer_id=Uuid::new_v4().to_string();let path=dir.join(format!(".native-{transfer_id}.part"));
        let file=fs::OpenOptions::new().create_new(true).write(true).open(&path).map_err(|_|"upload_create")?;
        if let Err(e)=service.store.begin_browser_upload(&id,index){drop(file);let _=fs::remove_file(&path);return Err(e);}
        let generation=service.generation.load(Ordering::Acquire);
        Ok(Self{service,transfer_id,id,index,path,file:Some(file),expected,written:0,sequence:0,generation,started:Instant::now(),_permit:permit})
    }
    fn check(&self,value:&Value)->Result<(),String>{
        if value["transferId"]!=self.transfer_id{return Err("invalid_transfer_id".into());}
        if self.started.elapsed()>Duration::from_secs(180){return Err("upload_timeout".into());}
        if !self.service.enabled.load(Ordering::Acquire)||self.generation!=self.service.generation.load(Ordering::Acquire)||self.service.store.cancelled(&self.id){return Err("upload_cancelled_or_revoked".into());}Ok(())
    }
    pub fn chunk(&mut self,value:&Value)->Result<Value,String>{
        self.check(value)?;
        if value["sequence"].as_u64()!=Some(self.sequence){return Err("invalid_chunk_sequence".into());}
        let encoded=value["data"].as_str().filter(|s|!s.is_empty()&&s.len()<=super::native_protocol::PDF_CHUNK_BYTES*4/3).ok_or("invalid_chunk_size")?;
        let bytes=STANDARD.decode(encoded).map_err(|_|"invalid_base64")?;
        if bytes.is_empty()||bytes.len()>super::native_protocol::PDF_CHUNK_BYTES||self.written+bytes.len() as u64>self.expected{return Err("invalid_chunk_size".into());}
        self.file.as_mut().ok_or("upload_closed")?.write_all(&bytes).map_err(|_|"upload_write")?;
        self.written+=bytes.len() as u64;self.sequence+=1;Ok(json!({"received":self.written,"nextSequence":self.sequence}))
    }
    pub fn finish(mut self,state:&super::native_state::NativeState,value:&Value)->Result<Value,String>{
        self.check(value)?;if self.written!=self.expected{return Err("incomplete_pdf_upload".into());}
        self.file.take().ok_or("upload_closed")?.sync_all().map_err(|_|"upload_sync")?;
        let (hash,size)=download::verify(&self.path)?;
        let _gate=state.gate.lock().map_err(|_|"native_lock")?;self.check(value)?;
        let destination=self.path.parent().ok_or("upload_directory")?.join(format!("{}.pdf",self.index));
        let published=if destination.exists(){if download::verify(&destination)?.0!=hash{return Err("已有不同PDF，请使用文献详情补充新版文件".into());}false}
            else{fs::hard_link(&self.path,&destination).map_err(|_|"upload_publish")?;true};
        if let Err(e)=self.service.store.end_browser_upload(&self.id,true){if published{let _=fs::remove_file(&destination);}return Err(e);}
        Ok(json!({"captureId":self.id,"state":"queued","sha256":hash,"byteLength":size}))
    }
}
impl Drop for Upload{fn drop(&mut self){self.file=None;let _=fs::remove_file(&self.path);let _=self.service.store.end_browser_upload(&self.id,false);}}

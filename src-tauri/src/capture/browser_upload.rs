//! Explicit browser-assisted transfer. Authenticated, one bounded upload at a time.
use super::*;
use axum::{body::to_bytes,extract::Request};
use std::{fs,io::Write};
static GATE:OnceLock<Arc<tokio::sync::Semaphore>>=OnceLock::new();
fn authorized(s:&Service,token:&str,generation:u64)->bool{
    s.enabled.load(Ordering::Acquire) && generation==s.generation.load(Ordering::Acquire) && s.pair.lock().ok().and_then(|p|p.as_ref().map(|p|Instant::now()<p.token_deadline && !p.token.is_empty() && same_secret(&p.token,token))).unwrap_or(false)
}
pub(super) async fn receive(s:Arc<Service>,request:Request,token:String)->Response{
    let parts:Vec<_>=request.uri().path().split('/').collect();
    if parts.len()!=6 || parts[4]!="browser-pdf" {return error(StatusCode::NOT_FOUND,"unknown_upload_route");}
    let id=parts[3].to_string();
    let index=parts[5].parse::<usize>().ok();
    if Uuid::parse_str(&id).map(|u|u.to_string()!=id).unwrap_or(true) || index.is_none_or(|i|i>=100){return error(StatusCode::BAD_REQUEST,"invalid_upload_identity");}
    if request.headers().get("content-type").and_then(|v|v.to_str().ok())!=Some("application/pdf"){return error(StatusCode::UNSUPPORTED_MEDIA_TYPE,"pdf_body_required");}
    let gate=GATE.get_or_init(||Arc::new(tokio::sync::Semaphore::new(1))).clone();
    let Ok(permit)=gate.try_acquire_owned() else{return error(StatusCode::TOO_MANY_REQUESTS,"another_pdf_upload_is_running");};
    if let Err(e)=s.store.begin_browser_upload(&id,index.unwrap()){return error(StatusCode::CONFLICT,&e);}
    let generation=s.generation.load(Ordering::Acquire);
    let bytes=match tokio::time::timeout(Duration::from_secs(60),to_bytes(request.into_body(),download::FILE_LIMIT as usize)).await{
        Ok(Ok(b))=>b,_=>{let _=s.store.end_browser_upload(&id,false);return error(StatusCode::BAD_REQUEST,"pdf_upload_incomplete_or_over_50mib");}
    };
    let service=s.clone();let task=id.clone();
    let result=tokio::task::spawn_blocking(move||{
        let _permit=permit;
        if !authorized(&service,&token,generation) || service.store.cancelled(&task){return Err("upload_cancelled_or_revoked".into());}
        let directory=service.root.join("items").join(&task);fs::create_dir_all(&directory).map_err(|_|"upload_directory")?;
        if !directory.canonicalize().map_err(|_|"upload_directory")?.starts_with(service.root.canonicalize().map_err(|_|"upload_directory")?){return Err("upload_directory_escape".into());}
        if download::directory_size(&service.root)?.saturating_add(bytes.len() as u64)>1024*1024*1024{return Err("capture_disk_quota_1gib".into());}
        let part=directory.join(format!(".browser-{}.part",Uuid::new_v4()));
        struct Cleanup(PathBuf);impl Drop for Cleanup{fn drop(&mut self){let _=fs::remove_file(&self.0);}}
        let _cleanup=Cleanup(part.clone());
        let mut output=fs::OpenOptions::new().write(true).create_new(true).open(&part).map_err(|_|"upload_create")?;
        output.write_all(&bytes).map_err(|_|"upload_write")?;output.sync_all().map_err(|_|"upload_sync")?;drop(output);
        let (hash,size)=download::verify(&part)?;
        if !authorized(&service,&token,generation) || service.store.cancelled(&task){return Err("upload_cancelled_or_revoked".into());}
        let final_path=directory.join(format!("{}.pdf",index.unwrap()));
        let published=if final_path.exists(){if download::verify(&final_path)?.0!=hash{return Err("已有不同PDF，请重新采集或使用文献详情补充新版文件".into());}false}
            else{fs::hard_link(&part,&final_path).map_err(|_|"upload_publish")?;true};
        if let Err(e)=service.store.end_browser_upload(&task,true){if published{let _=fs::remove_file(&final_path);}return Err(e);}
        Ok(json!({"captureId":task,"state":"queued","sha256":hash,"byteLength":size}))
    }).await.unwrap_or_else(|_|Err("upload_worker_failed".into()));
    match result{Ok(v)=>Json(v).into_response(),Err(e)=>{let _=s.store.end_browser_upload(&id,false);error(StatusCode::BAD_REQUEST,&e)}}
}

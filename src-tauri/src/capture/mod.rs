//! Native Messaging capture service. HTTP support is retained only in regression tests.
mod download;
pub(crate) mod ingest;
mod library_api;
mod metadata;
mod model;
mod folders;
mod store;
mod native_state;
mod native_upload;
mod native_runtime;
#[cfg(windows)] mod native_server;
#[path = "../native_messaging/protocol.rs"] mod native_protocol;
#[cfg(windows)] #[path = "../native_messaging/windows.rs"] mod native_windows;
pub use native_runtime::start_native;
use serde::Deserialize;
use serde_json::{json,Value};
use std::{path::PathBuf,sync::{Arc,Mutex,OnceLock,atomic::{AtomicBool,AtomicU64,Ordering}},time::{Duration,Instant}};
use tauri::{AppHandle,Emitter};
use uuid::Uuid;
struct Service { root:PathBuf,library_root:PathBuf,notify:Option<Arc<dyn Fn(&Value)+Send+Sync>>,enrich_metadata:AtomicBool,terminating:AtomicBool,enabled:AtomicBool,generation:AtomicU64,store:store::Store,
    #[cfg(test)] port:u16,#[cfg(test)] pair:Mutex<Option<Pair>>,#[cfg(test)] requests:tokio::sync::Semaphore,
}
static SERVICE:OnceLock<Mutex<Option<Arc<Service>>>>=OnceLock::new();
fn slot()->&'static Mutex<Option<Arc<Service>>>{SERVICE.get_or_init(||Mutex::new(None))}
fn current()->Result<Arc<Service>,String>{slot().lock().map_err(|_|"capture_service_lock")?.clone().ok_or("capture_service_not_started".into())}
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Control {action:String,capture_id:Option<String>,paper_id:Option<String>,file_id:Option<String>,local_path:Option<String>,enrich_metadata:Option<bool>}
#[tauri::command(async)]
pub fn capture_control(app:AppHandle,request:Control)->Result<Value,String>{
    if matches!(request.action.as_str(),"paper_details"|"open_library_file"|"attach_pdf"){
        let root=crate::app_paths::app_data_root(&app)?;let paper=request.paper_id.as_deref().ok_or("missing_paper_id")?;
        return match request.action.as_str(){
            "paper_details"=>library_api::details(&root,paper),
            "open_library_file"=>{library_api::open_file(&root,paper,request.file_id.as_deref().ok_or("missing_file_id")?)?;Ok(json!({"ok":true}))},
            _=>{let result=library_api::attach(&root,paper,std::path::Path::new(request.local_path.as_deref().ok_or("missing_local_path")?))?;let _=app.emit("capture://library-changed",&result);Ok(result)},
        };
    }
    if request.action=="status"{return Ok(native_runtime::status());}
    if request.action=="pair"{return Err("旧HTTP配对已停用，请使用新版原生通信扩展".into());}
    let native=native_runtime::current_native()?;let s=&native.service;
    match request.action.as_str(){
        "disable"=>{native.revoke()?;Ok(json!({"enabled":false}))},
        "preferences"=>{let enabled=request.enrich_metadata.ok_or("missing_preference")?;s.store.set_native_setting("enrich_metadata",enabled)?;s.enrich_metadata.store(enabled,Ordering::Release);Ok(json!({"ok":true}))},
        "retry"|"cancel"=>{s.store.action(request.capture_id.as_deref().ok_or("missing_capture_id")?,&request.action)?;Ok(json!({"ok":true}))},
        "reveal"=>{crate::app_paths::open_path_in_file_manager(&s.root)?;Ok(json!({"ok":true}))},
        _=>Err("unknown_capture_action".into()),
    }
}
pub fn shutdown(){if let Ok(s)=current(){s.enabled.store(false,Ordering::Release);s.terminating.store(true,Ordering::Release);s.generation.fetch_add(1,Ordering::AcqRel);}}
fn worker_loop(s:Arc<Service>) {
    loop {
        if s.terminating.load(Ordering::Acquire) { break; }
        if !s.enabled.load(Ordering::Acquire) { std::thread::sleep(Duration::from_millis(500));continue; }
        let generation=s.generation.load(Ordering::Acquire);
        match s.store.claim() {
            Ok(Some((id,mut envelope)))=>{
                if s.enrich_metadata.load(Ordering::Acquire){
                    metadata::enrich(&mut envelope,&|| !s.enabled.load(Ordering::Acquire) || generation!=s.generation.load(Ordering::Acquire) || s.store.cancelled(&id));
                    if s.store.save_enriched(&id,&envelope).is_err(){s.enabled.store(false,Ordering::Release);continue;}
                }
                let (mut state,mut result)=download::process(&s.root,&id,&envelope,|| !s.enabled.load(Ordering::Acquire) || generation!=s.generation.load(Ordering::Acquire) || s.store.cancelled(&id));
                if s.enabled.load(Ordering::Acquire) && generation==s.generation.load(Ordering::Acquire) && !s.store.cancelled(&id) {
                    let imported=ingest::browser_files(&s.root,&envelope,&result).and_then(|files|ingest::ingest(&s.library_root,&envelope,&files,None));
                    match imported {
                        Ok(value)=>{result["libraryImported"]=json!(true);result["library"]=value.clone();if let Some(notify)=&s.notify {notify(&value);}},
                        Err(error)=>{result["libraryImported"]=json!(false);result["libraryError"]=json!(error);state="needs_user".into();},
                    }
                }
                if s.store.finish(&id,&state,&result).is_err() {
                    // Fail closed on persistence failure; do not claim more work.
                    s.enabled.store(false,Ordering::Release);
                }
            },
            Ok(None)=>std::thread::sleep(Duration::from_millis(500)),
            Err(_)=>{s.enabled.store(false,Ordering::Release);},
        }
    }
}

#[cfg(test)] use axum::{extract::{Request,State},http::{HeaderValue,Method,StatusCode},response::{IntoResponse,Response},Json,Router};
#[cfg(test)] use sha2::{Digest,Sha256};
#[cfg(test)] struct Pair{extension:String,code:String,deadline:Instant,token:String,token_deadline:Instant,failures:u8}
#[cfg(test)] fn extension_valid(id:&str)->bool{id.len()==32&&id.bytes().all(|b|(b'a'..=b'p').contains(&b))}
#[cfg(test)] fn same_secret(a:&str,b:&str)->bool{let aa=Sha256::digest(a.as_bytes());let bb=Sha256::digest(b.as_bytes());aa.iter().zip(bb).fold(0u8,|acc,(a,b)|acc|(*a^b))==0}
#[cfg(test)] mod legacy_http_tests;
#[cfg(test)] use legacy_http_tests::{handle,error};
#[cfg(test)] mod browser_upload;
#[cfg(test)] mod ingest_tests;
#[cfg(test)] mod live_tests;

#[cfg(test)] mod native_tests;

#[cfg(all(test,windows))] mod native_host_process_tests;

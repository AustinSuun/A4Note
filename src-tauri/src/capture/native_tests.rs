use super::*;
use super::native_state::{NativeState,Session};
use base64::{Engine,engine::general_purpose::STANDARD};
use std::{fs,sync::atomic::AtomicUsize};
pub(super) fn service(root:&std::path::Path,enabled:bool)->Arc<Service>{Arc::new(Service{root:root.into(),library_root:root.join("library"),notify:None,enrich_metadata:AtomicBool::new(false),terminating:AtomicBool::new(false),enabled:AtomicBool::new(enabled),generation:AtomicU64::new(0),store:store::Store::open(&root.join("capture.db")).unwrap(),port:0,pair:Mutex::new(None),requests:tokio::sync::Semaphore::new(8)})}
pub(super) struct Root(pub PathBuf);impl Root{pub(super) fn new()->Self{let p=std::env::temp_dir().join(format!("a4-native-{}",Uuid::new_v4()));fs::create_dir_all(&p).unwrap();Self(p)}}impl Drop for Root{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
fn call(n:&NativeState,s:&mut Session,op:&str,payload:Value)->Value{n.dispatch(native_protocol::decode_request(json!({"id":1,"operation":op,"payload":payload})).unwrap(),s)}
#[test]fn native_authorization_persists_and_revocation_wins_over_pending_prompt(){
    let root=Root::new();let s=service(&root.0,false);let count=Arc::new(AtomicUsize::new(0));let counted=count.clone();
    let n=NativeState::new(s.clone(),Arc::new(move||{counted.fetch_add(1,Ordering::SeqCst);true}));let mut session=Session{upload:None};
    assert_eq!(call(&n,&mut session,"submit",model::fixture())["error"]["code"],"access_required");
    assert_eq!(call(&n,&mut session,"hello",json!({}))["result"]["authorized"],false);assert_eq!(count.load(Ordering::SeqCst),0);
    assert_eq!(call(&n,&mut session,"request_access",json!({}))["ok"],true);assert!(s.store.native_setting("authorized",false).unwrap());
    assert_eq!(call(&n,&mut session,"request_access",json!({}))["ok"],true);assert_eq!(count.load(Ordering::SeqCst),1);
    n.revoke().unwrap();assert!(!s.store.native_setting("authorized",true).unwrap());
    let cancelled=s.clone();let n2=NativeState::new(s.clone(),Arc::new(move||{cancelled.generation.fetch_add(1,Ordering::AcqRel);true}));assert_eq!(n2.request_access().is_err(),true);
    let denied=NativeState::new(s.clone(),Arc::new(||false));assert_eq!(call(&denied,&mut session,"request_access",json!({}))["error"]["code"],"access_denied");
    drop(denied);drop(n2);drop(n);drop(s);let reopened=service(&root.0,false);assert!(!reopened.store.native_setting("authorized",true).unwrap());
}
#[test]fn native_pdf_chunks_ingest_without_http_and_cancel_cleans_temp(){
    let root=Root::new();let s=service(&root.0,true);let n=NativeState::new(s.clone(),Arc::new(||true));let mut session=Session{upload:None};
    let mut envelope=model::fixture();envelope["artifacts"]=json!([{"id":"main","role":"fulltext","state":"discovered","url":"https://example.org/a.pdf"}]);
    s.store.submit(&envelope).unwrap();let (id,_)=s.store.claim().unwrap().unwrap();s.store.finish(&id,"needs_user",&json!({})).unwrap();
    let before=ingest::ingest(&s.library_root,&envelope,&[],None).unwrap();
    let input=root.0.join("input.pdf");ingest_tests::pdf(&input,100);let bytes=fs::read(input).unwrap();
    let begin=call(&n,&mut session,"pdf_begin",json!({"captureId":id,"index":0,"byteLength":bytes.len()}));let transfer=begin["result"]["transferId"].as_str().unwrap();
    assert_eq!(call(&n,&mut session,"pdf_chunk",json!({"transferId":transfer,"sequence":1,"data":STANDARD.encode(&bytes)}))["ok"],false);
    assert_eq!(call(&n,&mut session,"pdf_chunk",json!({"transferId":transfer,"sequence":0,"data":STANDARD.encode(&bytes)}))["ok"],true);
    assert_eq!(call(&n,&mut session,"pdf_finish",json!({"transferId":transfer}))["ok"],true);assert!(session.upload.is_none());
    s.store.claim().unwrap().unwrap();let (state,result)=download::process(&root.0,&id,&envelope,||false);assert_eq!(state,"complete");
    let after=ingest::ingest(&s.library_root,&envelope,&ingest::browser_files(&root.0,&envelope,&result).unwrap(),None).unwrap();assert_eq!(after["paperId"],before["paperId"]);assert_eq!(after["hasSourcePdf"],true);
    s.store.finish(&id,"needs_user",&result).unwrap();
    let begin=call(&n,&mut session,"pdf_begin",json!({"captureId":id,"index":0,"byteLength":bytes.len()}));let transfer=begin["result"]["transferId"].as_str().unwrap();n.revoke().unwrap();
    assert_eq!(call(&n,&mut session,"pdf_chunk",json!({"transferId":transfer,"sequence":0,"data":STANDARD.encode(&bytes)}))["ok"],false);assert!(session.upload.is_none());
    assert!(fs::read_dir(root.0.join("items").join(&id)).unwrap().all(|e|!e.unwrap().file_name().to_string_lossy().ends_with(".part")));
}
#[cfg(windows)]
#[tokio::test]async fn native_pipe_acl_peer_binding_and_real_frame_roundtrip(){
    use tokio::{io::{AsyncReadExt,AsyncWriteExt},net::windows::named_pipe::ClientOptions};
    let root=Root::new();let s=service(&root.0,false);let n=Arc::new(NativeState::new(s,Arc::new(||true)));
    let name=format!("{}-test-{}",native_windows::pipe_name().unwrap(),Uuid::new_v4());let server=native_server::create_pipe(&name,true).unwrap();assert!(native_server::create_pipe(&name,true).is_err());
    let expected=std::env::current_exe().unwrap();let task=tokio::spawn(async move{server.connect().await.unwrap();native_server::connection(server,n,expected).await});
    let mut client=ClientOptions::new().open(&name).unwrap();
    let packet=json!({"origin":native_windows::allowed_origin(),"request":{"id":7,"operation":"hello"}});let mut bytes=Vec::new();native_protocol::write_frame(&mut bytes,&packet).unwrap();client.write_all(&bytes).await.unwrap();
    let mut prefix=[0;4];client.read_exact(&mut prefix).await.unwrap();let mut body=vec![0;u32::from_ne_bytes(prefix) as usize];client.read_exact(&mut body).await.unwrap();let response:Value=serde_json::from_slice(&body).unwrap();assert_eq!(response["id"],7);assert_eq!(response["result"]["authorized"],false);
    let packet=json!({"origin":"chrome-extension://forged/","request":{"id":8,"operation":"hello"}});let mut bytes=Vec::new();native_protocol::write_frame(&mut bytes,&packet).unwrap();client.write_all(&bytes).await.unwrap();assert_eq!(task.await.unwrap().unwrap_err(),"native_origin_rejected");
}

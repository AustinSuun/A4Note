//! Explicit opt-in live tests use public papers and isolated disposable directories.
use super::*;
use serde_json::json;
use std::fs;
#[test]
#[ignore = "downloads a public arXiv PDF; explicit network acceptance only"]
fn capture_live_public_pdf_to_library(){
    let root=std::env::temp_dir().join(format!("a4-live-capture-{}",Uuid::new_v4()));fs::create_dir_all(&root).unwrap();
    struct Cleanup(std::path::PathBuf);impl Drop for Cleanup{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
    let _cleanup=Cleanup(root.clone());
    let mut envelope=model::fixture();
    envelope["sourceUrl"]=json!("https://arxiv.org/abs/1706.03762");
    envelope["metadata"]["title"]=json!("Attention Is All You Need");
    envelope["metadata"]["identifiers"]=json!({"arxiv":"1706.03762"});
    envelope["artifacts"]=json!([{"id":"main","role":"fulltext","url":"https://arxiv.org/pdf/1706.03762","state":"discovered"}]);
    let id=envelope["captureId"].as_str().unwrap();
    let (state,result)=download::process(&root,id,&envelope,||false);
    assert_eq!(state,"complete","public download did not succeed: {result}");
    let files=ingest::browser_files(&root,&envelope,&result).unwrap();
    let imported=ingest::ingest(&root.join("library"),&envelope,&files,None).unwrap();
    assert_eq!(imported["hasSourcePdf"],true);
    println!("Live arXiv PDF verified and imported to isolated library: {} bytes",result["artifacts"][0]["byteLength"]);
}
#[test]
#[ignore = "queries public metadata providers; explicit network acceptance only"]
fn capture_live_provider_metadata(){
    let mut envelope=model::fixture();envelope["metadata"]["identifiers"]=json!({"doi":"10.1038/431601a","pmcid":"PMC7095415"});
    metadata::enrich(&mut envelope,&||false);
    assert!(envelope["raw"]["providers"]["crossref"].is_object(),"Crossref unavailable: {}",envelope["warnings"]);
    assert!(envelope["raw"]["providers"]["europepmc"].is_object(),"Europe PMC unavailable: {}",envelope["warnings"]);
    println!("Live Crossref and Europe PMC exact-ID metadata verified");
}
#[tokio::test]
async fn capture_real_loopback_transport_and_durable_acceptance(){
    let root=std::env::temp_dir().join(format!("a4-loopback-{}",Uuid::new_v4()));fs::create_dir_all(&root).unwrap();
    let listener=tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST,0)).await.unwrap();let port=listener.local_addr().unwrap().port();
    let extension="a".repeat(32);
    let s=Arc::new(Service{root:root.clone(),library_root:root.join("library"),notify:None,port,enrich_metadata:AtomicBool::new(false),terminating:AtomicBool::new(false),enabled:AtomicBool::new(true),generation:AtomicU64::new(0),store:store::Store::open(&root.join("capture.db")).unwrap(),requests:tokio::sync::Semaphore::new(8),pair:Mutex::new(Some(Pair{extension:extension.clone(),code:"loopback-code".into(),deadline:Instant::now()+Duration::from_secs(60),token:String::new(),token_deadline:Instant::now(),failures:0}))});
    let router=Router::new().fallback(handle).with_state(s.clone());
    let server=tokio::spawn(async move{axum::serve(listener,router).await.unwrap();});
    let client=reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(5)).build().unwrap();
    let response=client.post(format!("http://127.0.0.1:{port}/v1/pair")).header("Connection","close").header("Content-Type","application/json").header("X-A4-Extension",&extension).body(r#"{"code":"loopback-code"}"#).send().await.unwrap();
    assert_eq!(response.status(),200);let pair:Value=serde_json::from_str(&response.text().await.unwrap()).unwrap();
    let mut envelope=model::fixture();
    envelope["artifacts"]=json!([{"id":"main","role":"fulltext","state":"discovered","url":"https://example.org/paper.pdf"}]);
    let response=client.post(format!("http://127.0.0.1:{port}/v1/captures")).header("Connection","close").header("Content-Type","application/json").header("X-A4-Extension",&extension).bearer_auth(pair["token"].as_str().unwrap()).body(envelope.to_string()).send().await.unwrap();
    assert_eq!(response.status(),202);let _:Value=serde_json::from_str(&response.text().await.unwrap()).unwrap();
    assert_eq!(s.store.claim().unwrap().unwrap().0,envelope["captureId"].as_str().unwrap());
    let id=envelope["captureId"].as_str().unwrap();
    s.store.finish(id,"needs_user",&json!({"libraryImported":true})).unwrap();
    let before=ingest::ingest(&s.library_root,&envelope,&[],None).unwrap();
    let url=format!("http://127.0.0.1:{port}/v1/captures/{id}/browser-pdf/0");
    let bad=client.post(&url).header("Connection","close").header("Content-Type","application/pdf").header("X-A4-Extension",&extension).bearer_auth(pair["token"].as_str().unwrap()).body("<html>login</html>").send().await.unwrap();
    assert_eq!(bad.status(),400);let _=bad.text().await.unwrap();
    let pdf=root.join("input.pdf");ingest_tests::pdf(&pdf,100);
    let uploaded=client.post(&url).header("Connection","close").header("Content-Type","application/pdf").header("X-A4-Extension",&extension).bearer_auth(pair["token"].as_str().unwrap()).body(fs::read(&pdf).unwrap()).send().await.unwrap();
    let status=uploaded.status();let body=uploaded.text().await.unwrap();assert_eq!(status,200,"{body}");
    let (claimed,stored)=s.store.claim().unwrap().unwrap();assert_eq!(claimed,id);
    let (state,result)=download::process(&root,id,&stored,||false);assert_eq!(state,"complete");
    let files=ingest::browser_files(&root,&stored,&result).unwrap();
    let after=ingest::ingest(&s.library_root,&stored,&files,None).unwrap();assert_eq!(after["paperId"],before["paperId"]);assert_eq!(after["hasSourcePdf"],true);
    s.store.finish(id,"needs_user",&result).unwrap();
    ingest_tests::pdf(&pdf,200);
    let overwrite=client.post(&url).header("Connection","close").header("Content-Type","application/pdf").header("X-A4-Extension",&extension).bearer_auth(pair["token"].as_str().unwrap()).body(fs::read(&pdf).unwrap()).send().await.unwrap();
    assert_eq!(overwrite.status(),400);assert!(overwrite.text().await.unwrap().contains("已有不同PDF"));
    assert_eq!(download::verify(&root.join("items").join(id).join("0.pdf")).unwrap().0,files[0].hash);
    s.store.begin_browser_upload(id,0).unwrap();s.store.action(id,"cancel").unwrap();assert!(s.store.end_browser_upload(id,true).is_err());assert!(s.store.cancelled(id));
    drop(client);server.abort();let _=server.await;drop(s);
    // Existing requests used Connection: close; allow connection tasks to release their router clones.
    tokio::task::yield_now().await;
    fs::remove_dir_all(root).unwrap();
}

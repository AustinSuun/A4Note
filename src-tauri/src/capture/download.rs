//! Public HTTPS downloads only: resolve, reject non-public IPs, then pin resolution.
//! No proxy, browser cookies, automatic redirects or remote filenames.
use reqwest::{blocking::Client, Url};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs::{self, File, OpenOptions}, io::{Read, Write}, net::{IpAddr, ToSocketAddrs}, path::Path, time::{Duration, Instant}};
pub const FILE_LIMIT: u64 = 50 * 1024 * 1024;
const DISK_LIMIT: u64 = 1024 * 1024 * 1024;
pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let [a,b,c,_]=v.octets();
            !(a==0 || a==10 || a==127 || a>=224 || (a==100 && (64..=127).contains(&b))
              || (a==169 && b==254) || (a==172 && (16..=31).contains(&b))
              || (a==192 && (b==168 || b==0 || (b==88 && c==99)))
              || (a==198 && (b==18 || b==19 || (b==51 && c==100))) || (a==203 && b==0 && c==113))
        }
        IpAddr::V6(v) => {
            let s=v.segments();
            // Conservative global-unicast allowlist; reject mapped, NAT64, Teredo,
            // 6to4, documentation and special-purpose 2001 blocks.
            (s[0] & 0xe000)==0x2000 && s[0]!=0x2002 && !(s[0]==0x2001 && (s[1]<0x200 || s[1]==0xdb8))
                && !(s[0]==0x3fff)
        }
    }
}
pub fn checked_url(raw: &str) -> Result<Url,String> {
    let u=Url::parse(raw).map_err(|_| "invalid_download_url")?;
    if u.scheme()!="https" || u.host_str().is_none() || u.port_or_known_default()!=Some(443)
        || !u.username().is_empty() || u.password().is_some() { return Err("only_public_https_443_supported".into()); }
    Ok(u)
}
pub(super) fn directory_size(root: &Path) -> Result<u64,String> {
    let mut total=0;
    for entry in fs::read_dir(root).map_err(|_| "capture_storage_read")? {
        let entry=entry.map_err(|_| "capture_storage_read")?;
        let meta=fs::symlink_metadata(entry.path()).map_err(|_| "capture_storage_read")?;
        if meta.file_type().is_symlink() { return Err("capture_symlink_rejected".into()); }
        total+=if meta.is_dir() { directory_size(&entry.path())? } else { meta.len() };
        if total>DISK_LIMIT { return Err("capture_disk_quota_1gib".into()); }
    }
    Ok(total)
}
pub(crate) fn verify(path: &Path) -> Result<(String,u64),String> {
    let mut f=File::open(path).map_err(|_| "capture_file_read")?;
    let size=f.metadata().map_err(|_| "capture_file_read")?.len();
    if size>FILE_LIMIT || size<8 { return Err("invalid_pdf_size".into()); }
    let mut signature=[0u8;5]; f.read_exact(&mut signature).map_err(|_| "invalid_pdf")?;
    if &signature!=b"%PDF-" { return Err("not_pdf_login_or_error_page".into()); }
    // Parse structure even if scanned/image-only; successful text extraction is not required.
    let document=lopdf::Document::load(path).map_err(|_| "pdf_structure_invalid_or_unsupported")?;
    if document.is_encrypted() { return Err("encrypted_pdf_needs_user".into()); }
    if document.get_pages().is_empty() { return Err("pdf_has_no_pages".into()); }
    let mut hash=Sha256::new(); let mut f=File::open(path).map_err(|_| "capture_file_read")?;
    let mut buf=[0u8;65536];
    loop { let n=f.read(&mut buf).map_err(|_| "capture_file_read")?; if n==0 { break; } hash.update(&buf[..n]); }
    Ok((format!("{:x}",hash.finalize()),size))
}
fn fetch(raw:&str, part:&Path, budget:u64, cancel:&impl Fn()->bool) -> Result<(),String> {
    let mut url=checked_url(raw)?; let started=Instant::now();
    for _ in 0..6 {
        if cancel() { return Err("cancelled_or_service_disabled".into()); }
        if started.elapsed()>Duration::from_secs(180) { return Err("download_timeout".into()); }
        let host=url.host_str().ok_or("invalid_host")?.to_string();
        let addresses:Vec<_>=(host.as_str(),443).to_socket_addrs().map_err(|_| "dns_failed")?.collect();
        if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) { return Err("non_public_address_rejected".into()); }
        let client=Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
            .referer(false).connect_timeout(Duration::from_secs(12)).timeout(Duration::from_secs(45))
            .user_agent("A4Note-Capture/0.1 (user-initiated public PDF capture)")
            .resolve_to_addrs(&host,&addresses).build().map_err(|_| "http_client_failed")?;
        let mut response=client.get(url.clone()).send().map_err(|_e| { #[cfg(test)] eprintln!("Public PDF transport failure: {_e:?}"); "network_or_tls_error" })?;
        if response.status().is_redirection() {
            let location=response.headers().get(reqwest::header::LOCATION).and_then(|v|v.to_str().ok()).ok_or("redirect_without_location")?;
            url=checked_url(url.join(location).map_err(|_| "invalid_redirect")?.as_str())?;
            continue;
        }
        if matches!(response.status().as_u16(),401|403) { return Err("login_or_permission_required".into()); }
        if !response.status().is_success() { return Err(format!("http_status_{}",response.status().as_u16())); }
        let limit=FILE_LIMIT.min(budget);
        if response.content_length().is_some_and(|size|size>limit) { return Err("file_or_disk_limit_exceeded".into()); }
        let mut file=OpenOptions::new().create_new(true).write(true).open(part).map_err(|_| "capture_temp_create")?;
        let mut bytes=0; let mut buf=[0u8;65536];
        loop {
            if cancel() { return Err("cancelled_or_service_disabled".into()); }
            if started.elapsed()>Duration::from_secs(180) { return Err("download_timeout".into()); }
            let n=response.read(&mut buf).map_err(|_| "download_stream_failed")?;
            if n==0 { break; } bytes+=n as u64;
            if bytes>limit { return Err("file_or_disk_limit_exceeded".into()); }
            file.write_all(&buf[..n]).map_err(|_| "capture_disk_write")?;
        }
        if response.content_length().is_some_and(|expected|expected!=bytes) { return Err("incomplete_download".into()); }
        file.sync_all().map_err(|_| "capture_disk_sync")?; return Ok(());
    }
    Err("too_many_redirects".into())
}
/// Bounded provider responses use the same resolve/reject/pin policy as PDFs.
pub(super) fn public_json(raw:&str,cancel:&impl Fn()->bool)->Result<Value,String>{
    let mut url=checked_url(raw)?;
    for _ in 0..3 {
        if cancel(){return Err("cancelled".into());}
        let host=url.host_str().ok_or("invalid_host")?.to_string();
        let addresses:Vec<_>=(host.as_str(),443).to_socket_addrs().map_err(|_|"provider_dns_failed")?.collect();
        if addresses.is_empty() || addresses.iter().any(|a|!public_ip(a.ip())){return Err("non_public_provider_address".into());}
        let client=Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).referer(false)
          .timeout(Duration::from_secs(12)).connect_timeout(Duration::from_secs(5))
          .user_agent("A4Note-Capture/0.3 (user-initiated identifier lookup)").resolve_to_addrs(&host,&addresses).build().map_err(|_|"provider_client_failed")?;
        let response=client.get(url.clone()).header("Accept","application/json").send().map_err(|_|"provider_network_error")?;
        if response.status().is_redirection(){let location=response.headers().get(reqwest::header::LOCATION).and_then(|h|h.to_str().ok()).ok_or("provider_redirect_error")?;url=checked_url(url.join(location).map_err(|_|"provider_redirect_error")?.as_str())?;continue;}
        if !response.status().is_success(){return Err(format!("provider_http_{}",response.status().as_u16()));}
        let mut data=Vec::new();response.take(512*1024+1).read_to_end(&mut data).map_err(|_|"provider_read_failed")?;
        if data.len()>512*1024{return Err("provider_response_too_large".into());}
        return serde_json::from_slice(&data).map_err(|_|"provider_invalid_json".into());
    }
    Err("provider_redirect_limit".into())
}
pub fn process(root:&Path, id:&str, envelope:&Value, cancel:impl Fn()->bool) -> (String,Value) {
    let run=|| -> Result<Value,String> {
        let dir=root.join("items").join(id);
        fs::create_dir_all(&dir).map_err(|_| "capture_directory_create")?;
        if fs::symlink_metadata(&dir).map_err(|_| "capture_storage_read")?.file_type().is_symlink() { return Err("capture_symlink_rejected".into()); }
        let mut results=Vec::new();
        for (index, artifact) in envelope["artifacts"].as_array().ok_or("invalid_artifacts")?.iter().enumerate() {
            if cancel() { return Err("cancelled_or_service_disabled".into()); }
            let supplement_pdf=artifact["role"]=="supplement" && artifact["url"].as_str().and_then(|u|reqwest::Url::parse(u).ok()).is_some_and(|u|u.path().to_lowercase().ends_with(".pdf")) || (artifact["role"]=="supplement" && dir.join(format!("{index}.pdf")).exists());
            if artifact["role"]!="fulltext" && !supplement_pdf {
                results.push(json!({"id":artifact["id"],"state":"needs_user","error":"link_only_or_non_pdf_attachment_use_browser_download"})); continue;
            }
            let final_path=dir.join(format!("{index}.pdf"));
            let part=dir.join(format!("{index}.part"));
            let attempt=|| -> Result<(String,u64),String> {
                // Completed bytes may survive a crash before the DB commit. Revalidate, never trust a flag.
                if final_path.exists() { return verify(&final_path); }
                if part.exists() { fs::remove_file(&part).map_err(|_| "capture_temp_cleanup")?; }
                let used=directory_size(root)?;
                fetch(artifact["url"].as_str().ok_or("missing_pdf_url")?, &part,DISK_LIMIT.saturating_sub(used),&cancel)?;
                let verified=verify(&part)?;
                if cancel() { return Err("cancelled_or_service_disabled".into()); }
                fs::rename(&part,&final_path).map_err(|_| "capture_publish_failed")?;
                Ok(verified)
            };
            match attempt() {
                Ok((hash,size))=>results.push(json!({"id":artifact["id"],"state":"verified","storedPath":format!("items/{id}/{index}.pdf"),"sha256":hash,"byteLength":size})),
                Err(error)=>{ let _=fs::remove_file(&part); results.push(json!({"id":artifact["id"],"state":"needs_user","error":error})); }
            }
        }
        Ok(json!({"artifacts":results,"libraryImported":false,"metadataVerified":false}))
    };
    match run() {
        Ok(result)=>{
            let rows=result["artifacts"].as_array().unwrap();
            let good=rows.iter().filter(|a|a["state"]=="verified").count();
            let state=if rows.is_empty() || good==0 { "needs_user" } else if good<rows.len() { "partial" } else { "complete" };
            (state.into(),result)
        }
        Err(error)=>("needs_user".into(),json!({"error":error,"libraryImported":false})),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn capture_rejects_private_mapped_reserved_and_non_https() {
        for s in ["127.0.0.1","10.2.1.1","169.254.169.254","100.64.1.1","192.168.1.1","198.18.0.1","203.0.113.2","::1","::ffff:8.8.8.8","2001:db8::1","2002:808:808::1"] { assert!(!public_ip(s.parse().unwrap()),"{s}"); }
        for s in ["8.8.8.8","1.1.1.1","2606:4700:4700::1111"] { assert!(public_ip(s.parse().unwrap()),"{s}"); }
        for s in ["file:///secret","http://example.org/a.pdf","https://u:p@example.org/a.pdf","https://example.org:8443/a"] { assert!(checked_url(s).is_err()); }
    }
    #[test] fn capture_valid_pdf_is_reverified_and_hashed_without_network() {
        use lopdf::{dictionary, Object};
        let root=std::env::temp_dir().join(format!("a4cap-valid-{}",uuid::Uuid::new_v4()));
        let mut envelope=super::super::model::fixture();
        let id=envelope["captureId"].as_str().unwrap().to_string();
        let dir=root.join("items").join(&id);fs::create_dir_all(&dir).unwrap();
        let mut doc=lopdf::Document::with_version("1.5");
        let pages=doc.new_object_id();
        let page=doc.add_object(dictionary! {"Type"=>"Page","Parent"=>pages,"MediaBox"=>vec![0.into(),0.into(),100.into(),100.into()]});
        doc.objects.insert(pages,dictionary! {"Type"=>"Pages","Kids"=>vec![Object::Reference(page)],"Count"=>1}.into());
        let catalog=doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages});doc.trailer.set("Root",catalog);
        doc.save(dir.join("0.pdf")).unwrap();
        envelope["artifacts"]=json!([{"id":"pdf","role":"fulltext","url":"https://example.org/not-requested.pdf"}]);
        let (state,result)=process(&root,&id,&envelope,||false);
        assert_eq!(state,"complete");assert_eq!(result["artifacts"][0]["sha256"].as_str().unwrap().len(),64);
        assert_eq!(result["libraryImported"],false);fs::remove_dir_all(root).unwrap();
    }
    #[test] fn capture_rejects_fake_pdf_and_cancellation_without_network() {
        let root=std::env::temp_dir().join(format!("a4cap-{}",uuid::Uuid::new_v4())); fs::create_dir_all(&root).unwrap();
        let file=root.join("fake.pdf"); fs::write(&file,b"<html>Login</html>").unwrap(); assert!(verify(&file).is_err());
        fs::write(&file,b"%PDF-1.7 broken").unwrap(); assert!(verify(&file).is_err());
        let v=super::super::model::fixture(); let (state,_)=process(&root,"fixture",&v,||true); assert_eq!(state,"needs_user");
        fs::remove_dir_all(root).unwrap();
    }
}

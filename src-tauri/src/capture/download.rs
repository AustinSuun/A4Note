//! Public HTTPS downloads only: resolve, reject non-public IPs, then pin resolution.
//! Restricted Windows loopback proxy for trusted arxiv.org only; no browser cookies, automatic redirects or remote filenames.
#[path = "system_proxy.rs"]
mod system_proxy;
#[path = "attachment.rs"]
pub(super) mod attachment;
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
/// Persist only an actionable category, never URLs, query tokens or OS paths.
fn transport_error(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() { return "download_timeout"; }
    let mut source=std::error::Error::source(error);
    while let Some(cause)=source {
        if let Some(io)=cause.downcast_ref::<std::io::Error>() {
            match io.kind() {
                std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted => return "network_connection_reset",
                std::io::ErrorKind::ConnectionRefused => return "network_connection_refused",
                std::io::ErrorKind::TimedOut => return "download_timeout",
                _ => {},
            }
        }
        source=cause.source();
    }
    // Do not label every connect failure a certificate problem.
    if error.is_connect() { "network_connect_failed" } else { "network_or_tls_error" }
}
fn fetch(raw:&str, part:&Path, budget:u64, cancel:&impl Fn()->bool, pdf_only:bool, progress:&mut impl FnMut(u64,Option<u64>)) -> Result<String,String> {
    let mut url=checked_url(raw)?; let started=Instant::now();
    for _ in 0..6 {
        if cancel() { return Err("cancelled_or_service_disabled".into()); }
        if started.elapsed()>Duration::from_secs(180) { return Err("download_timeout".into()); }
        let host=url.host_str().ok_or("invalid_host")?.to_string();
        let addresses:Vec<_>=(host.as_str(),443).to_socket_addrs().map_err(|_| "dns_failed")?.collect();
        if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) { return Err("non_public_address_rejected".into()); }
        // Re-evaluate every redirect. Only trusted arxiv.org may delegate DNS to
        // the user's explicitly enabled local static proxy. Other hosts remain
        // direct and DNS-pinned; never enable global/environment proxy discovery.
        let proxy=system_proxy::for_public_provider(&url)?;
        let via_proxy=proxy.is_some();
        let mut builder=Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
            .referer(false).connect_timeout(Duration::from_secs(12)).timeout(Duration::from_secs(45))
            .user_agent("A4Note-Capture/0.1 (user-initiated public PDF capture)")
            .resolve_to_addrs(&host,&addresses);
        if let Some(proxy)=proxy { builder=builder.proxy(proxy); }
        let client=builder.build().map_err(|_| "http_client_failed")?;
        let mut response=client.get(url.clone()).send().map_err(|error| {
            let code=transport_error(&error);
            if via_proxy { format!("system_proxy_{code}") } else { code.to_string() }
        })?;
        if response.status().is_redirection() {
            let location=response.headers().get(reqwest::header::LOCATION).and_then(|v|v.to_str().ok()).ok_or("redirect_without_location")?;
            url=checked_url(url.join(location).map_err(|_| "invalid_redirect")?.as_str())?;
            continue;
        }
        if matches!(response.status().as_u16(),401|403) { return Err("login_or_permission_required".into()); }
        if !response.status().is_success() { return Err(format!("http_status_{}",response.status().as_u16())); }
        let mime=response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v|v.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
        if matches!(mime.as_str(),"text/html"|"application/xhtml+xml") { return Err("attachment_is_html_or_login_page".into()); }
        let disposition=response.headers().get(reqwest::header::CONTENT_DISPOSITION).and_then(|v|v.to_str().ok()).and_then(|header|header.split(';').find_map(|part| {
            let (key,value)=part.trim().split_once('=')?;
            if key.eq_ignore_ascii_case("filename") || key.eq_ignore_ascii_case("filename*") { attachment::extension(value.trim().trim_matches('"')) } else { None }
        }));
        let mime_ext=match mime.as_str() {"application/pdf"=>Some("pdf"),"text/csv"=>Some("csv"),"text/tab-separated-values"=>Some("tsv"),"application/zip"=>Some("zip"),"application/gzip"=>Some("gz"),"application/json"=>Some("json"),"text/plain"=>Some("txt"),"image/png"=>Some("png"),"image/jpeg"=>Some("jpg"),"video/mp4"=>Some("mp4"),"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"=>Some("xlsx"),_=>None};
        let extension=if pdf_only { "pdf".into() } else { disposition.or_else(||attachment::from_url(url.as_str())).or_else(||attachment::from_url(raw)).or_else(||mime_ext.map(str::to_string)).ok_or("unsupported_supplement_format")? };
        let limit=FILE_LIMIT.min(budget);
        // reqwest reports a body size hint, not an immutable header value.
        // Reading the blocking body moves/drains it; snapshot before the first read.
        let expected_length=response.content_length();
        if expected_length.is_some_and(|size|size>limit) { return Err("file_or_disk_limit_exceeded".into()); }
        progress(0,expected_length);
        let mut reported=Instant::now();
        let mut file=OpenOptions::new().create_new(true).write(true).open(part).map_err(|_| "capture_temp_create")?;
        let mut bytes=0; let mut buf=[0u8;65536];
        loop {
            if cancel() { return Err("cancelled_or_service_disabled".into()); }
            if started.elapsed()>Duration::from_secs(180) { return Err("download_timeout".into()); }
            let n=response.read(&mut buf).map_err(|_| "download_stream_failed")?;
            if n==0 { break; } bytes+=n as u64;
            if bytes>limit { return Err("file_or_disk_limit_exceeded".into()); }
            file.write_all(&buf[..n]).map_err(|_| "capture_disk_write")?;
            if reported.elapsed()>=Duration::from_millis(250) { progress(bytes,expected_length);reported=Instant::now(); }
        }
        if expected_length.is_some_and(|expected|expected!=bytes) { return Err("incomplete_download".into()); }
        file.sync_all().map_err(|_| "capture_disk_sync")?; progress(bytes,expected_length); return Ok(extension);
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
pub fn process(root:&Path,id:&str,envelope:&Value,cancel:impl Fn()->bool)->(String,Value) {
    process_with_progress(root,id,envelope,cancel,&json!({}),|_|{})
}
/// Only server-generated progress/options are accepted here; never browser paths.
pub fn process_with_progress(root:&Path,id:&str,envelope:&Value,cancel:impl Fn()->bool,previous:&Value,progress:impl Fn(&Value))->(String,Value) {
    let run=||->Result<Value,String> {
        let dir=root.join("items").join(id);
        fs::create_dir_all(&dir).map_err(|_|"capture_directory_create")?;
        if fs::symlink_metadata(&dir).map_err(|_|"capture_storage_read")?.file_type().is_symlink(){return Err("capture_symlink_rejected".into());}
        let artifacts=envelope["artifacts"].as_array().ok_or("invalid_artifacts")?;
        let mut rows:Vec<Value>=artifacts.iter().enumerate().map(|(index,a)|json!({"id":a["id"],"index":index,"role":a["role"],"label":a["label"].as_str().unwrap_or("").chars().take(120).collect::<String>(),"state":"queued"})).collect();
        let emit=|rows:&[Value]|progress(&json!({"phase":"downloading","artifacts":rows,"libraryImported":false}));
        emit(&rows);
        for (index,a) in artifacts.iter().enumerate() {
            if cancel(){return Err("cancelled_or_service_disabled".into());}
            let pdf_only=a["role"]=="fulltext";
            if !pdf_only && a["role"]!="supplement" { rows[index]["state"]=json!("needs_user");rows[index]["error"]=json!("unsupported_artifact_role");emit(&rows);continue; }
            let prefix=format!("{index}.");
            let cached=fs::read_dir(&dir).map_err(|_|"capture_storage_read")?.filter_map(Result::ok).find_map(|entry| {
                let name=entry.file_name().to_str()?.to_string();let ext=name.strip_prefix(&prefix)?;
                let valid=attachment::extension(&name)?;
                (ext==valid && (!pdf_only || ext=="pdf")).then_some((entry.path(),valid))
            });
            let old=previous["artifacts"].as_array().and_then(|v|v.iter().find(|row|row["id"]==a["id"]));
            if cached.is_none() && previous["retryIndex"].as_u64().is_some_and(|wanted|wanted!=index as u64) {
                rows[index]["state"]=json!("needs_user");rows[index]["error"]=old.and_then(|r|r.get("error")).cloned().unwrap_or(json!("not_retried"));emit(&rows);continue;
            }
            rows[index]["state"]=json!("connecting");emit(&rows);
            let part=dir.join(format!("{index}.part"));
            let mut attempt=||->Result<(String,u64,String),String> {
                if let Some((path,ext))=&cached {
                    if fs::symlink_metadata(path).map_err(|_|"capture_storage_read")?.file_type().is_symlink(){return Err("capture_symlink_rejected".into());}
                    rows[index]["state"]=json!("verifying");emit(&rows);
                    return attachment::verify(path,ext).map(|(hash,size)|(hash,size,ext.clone()));
                }
                if part.exists(){fs::remove_file(&part).map_err(|_|"capture_temp_cleanup")?;}
                let used=directory_size(root)?;
                let ext=fetch(a["url"].as_str().ok_or("missing_artifact_url")?,&part,DISK_LIMIT.saturating_sub(used),&cancel,pdf_only,&mut |bytes,total| {
                    rows[index]["state"]=json!("downloading");rows[index]["bytesReceived"]=json!(bytes);rows[index]["totalBytes"]=json!(total);emit(&rows);
                })?;
                rows[index]["state"]=json!("verifying");rows[index]["extension"]=json!(ext);emit(&rows);
                let (hash,size)=attachment::verify(&part,&ext)?;
                if cancel(){return Err("cancelled_or_service_disabled".into());}
                let dest=dir.join(format!("{index}.{ext}"));
                fs::hard_link(&part,&dest).map_err(|_|"capture_publish_failed")?;
                fs::remove_file(&part).map_err(|_|"capture_temp_cleanup")?;
                Ok((hash,size,ext))
            };
            match attempt() {
                Ok((hash,size,ext))=>{rows[index]["state"]=json!("verified");rows[index]["storedPath"]=json!(format!("items/{id}/{index}.{ext}"));rows[index]["sha256"]=json!(hash);rows[index]["byteLength"]=json!(size);rows[index]["bytesReceived"]=json!(size);rows[index]["totalBytes"]=json!(size);rows[index]["extension"]=json!(ext);},
                Err(error)=>{let _=fs::remove_file(&part);rows[index]["state"]=json!("needs_user");rows[index]["error"]=json!(error);},
            }
            emit(&rows);
        }
        Ok(json!({"artifacts":rows,"libraryImported":false,"metadataVerified":false}))
    };
    match run() {
        Ok(result)=>{let rows=result["artifacts"].as_array().unwrap();let good=rows.iter().filter(|r|r["state"]=="verified").count();let state=if good==0{"needs_user"}else if good<rows.len(){"partial"}else{"complete"};(state.into(),result)},
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

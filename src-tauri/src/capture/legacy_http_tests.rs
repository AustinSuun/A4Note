//! Legacy loopback regressions only; not compiled into the shipped application.
use super::*;
pub(super) fn error(code:StatusCode,text:&str)->Response { (code,Json(model::failure(text))).into_response() }
pub(super) async fn handle(State(s):State<Arc<Service>>, request:Request)->Response {
    let Ok(_permit)=s.requests.try_acquire() else { return error(StatusCode::TOO_MANY_REQUESTS,"capture_busy"); };
    if !s.enabled.load(Ordering::Acquire) { return error(StatusCode::SERVICE_UNAVAILABLE,"capture_disabled"); }
    let expected_host=format!("127.0.0.1:{}",s.port);
    if request.headers().get("host").and_then(|v|v.to_str().ok())!=Some(expected_host.as_str()) { return error(StatusCode::FORBIDDEN,"invalid_host"); }
    let origin=request.headers().get("origin").and_then(|v|v.to_str().ok()).unwrap_or("").to_string();
    let expected_origin={
        let Ok(pair)=s.pair.lock() else { return error(StatusCode::INTERNAL_SERVER_ERROR,"pair_lock"); };
        let Some(pair)=pair.as_ref() else { return error(StatusCode::FORBIDDEN,"not_paired"); };
        format!("chrome-extension://{}",pair.extension)
    };
    if !origin.is_empty() && origin!=expected_origin { return error(StatusCode::FORBIDDEN,"invalid_origin"); }
    if request.method()==Method::OPTIONS {
        if origin!=expected_origin { return error(StatusCode::FORBIDDEN,"invalid_preflight"); }
        return cors(StatusCode::NO_CONTENT.into_response(),&expected_origin);
    }
    // Chromium may omit Origin for extension GET; custom extension identity + secret remain mandatory.
    let extension=request.headers().get("x-a4-extension").and_then(|v|v.to_str().ok()).unwrap_or("").to_string();
    if format!("chrome-extension://{extension}")!=expected_origin { return error(StatusCode::FORBIDDEN,"extension_mismatch"); }
    let method=request.method().clone();let path=request.uri().path().to_string();
    let token=request.headers().get("authorization").and_then(|v|v.to_str().ok()).unwrap_or("").strip_prefix("Bearer ").unwrap_or("").to_string();
    let pairing=path=="/v1/pair" && method==Method::POST;
    if !pairing {
        let allowed=s.pair.lock().ok().and_then(|p|p.as_ref().map(|p| !p.token.is_empty() && Instant::now()<p.token_deadline && same_secret(&p.token,&token))).unwrap_or(false);
        if !allowed { return cors(error(StatusCode::UNAUTHORIZED,"pairing_required_or_expired"),&expected_origin); }
    }
    if method==Method::POST && path.starts_with("/v1/captures/") && path.contains("/browser-pdf/") {
        return cors(browser_upload::receive(s.clone(),request,token).await,&expected_origin);
    }
    let body=if method==Method::POST {
        if request.headers().get("content-type").and_then(|v|v.to_str().ok()).map(|v|v.split(';').next().unwrap_or("").trim())!=Some("application/json") { return cors(error(StatusCode::UNSUPPORTED_MEDIA_TYPE,"json_required"),&expected_origin); }
        match tokio::time::timeout(Duration::from_secs(10),axum::body::to_bytes(request.into_body(),model::MAX_BODY)).await {
            Ok(Ok(bytes))=>match serde_json::from_slice::<Value>(&bytes) { Ok(v)=>v,Err(_)=>return cors(error(StatusCode::BAD_REQUEST,"invalid_json"),&expected_origin) },
            _=>return cors(error(StatusCode::PAYLOAD_TOO_LARGE,"body_limit_or_timeout"),&expected_origin),
        }
    } else { Value::Null };
    // Recheck after awaiting body: local revocation wins over an in-flight request.
    if !s.enabled.load(Ordering::Acquire) { return error(StatusCode::SERVICE_UNAVAILABLE,"capture_disabled"); }
    let mut pair=match s.pair.lock() { Ok(p)=>p,Err(_)=>return error(StatusCode::INTERNAL_SERVER_ERROR,"pair_lock") };
    let Some(p)=pair.as_mut() else { return error(StatusCode::FORBIDDEN,"not_paired"); };
    if !s.enabled.load(Ordering::Acquire) { return error(StatusCode::SERVICE_UNAVAILABLE,"capture_disabled"); }
    if p.extension!=extension { return error(StatusCode::FORBIDDEN,"extension_mismatch"); }
    let response=if pairing {
        if Instant::now()>p.deadline || p.failures>=5 || p.code.is_empty() { error(StatusCode::UNAUTHORIZED,"pairing_code_expired") }
        else if !same_secret(&p.code,body["code"].as_str().unwrap_or("")) { p.failures+=1;error(StatusCode::UNAUTHORIZED,"invalid_pairing_code") }
        else { p.code.clear();p.token=Uuid::new_v4().simple().to_string();p.token_deadline=Instant::now()+Duration::from_secs(12*3600);Json(json!({"token":p.token,"expiresInSeconds":43200})).into_response() }
    } else if p.token.is_empty() || Instant::now()>=p.token_deadline || !same_secret(&p.token,&token) {
        error(StatusCode::UNAUTHORIZED,"pairing_required_or_expired")
    } else if method==Method::POST && path=="/v1/captures" {
        match s.store.submit(&body) { Ok(v)=>(StatusCode::ACCEPTED,Json(v)).into_response(),Err(e)=>error(StatusCode::BAD_REQUEST,&e) }
    } else if method==Method::GET && path=="/v1/captures" {
        match s.store.list() { Ok(v)=>Json(v).into_response(),Err(e)=>error(StatusCode::INTERNAL_SERVER_ERROR,&e) }
    } else { error(StatusCode::NOT_FOUND,"route_not_found") };
    cors(response,&expected_origin)
}
pub(super) fn cors(mut response:Response,origin:&str)->Response {
    if let Ok(value)=HeaderValue::from_str(origin) { response.headers_mut().insert("access-control-allow-origin",value); }
    for (key,value) in [("access-control-allow-methods","GET, POST, OPTIONS"),("access-control-allow-headers","content-type, authorization, x-a4-extension"),("cache-control","no-store"),("vary","Origin"),("x-content-type-options","nosniff")] { response.headers_mut().insert(key,HeaderValue::from_static(value)); }
    response
}
#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    #[test] fn capture_pair_identity_and_secrets() {
        assert!(extension_valid(&"a".repeat(32)));assert!(!extension_valid("https://example.org"));
        assert!(!extension_valid(&"z".repeat(32)));assert!(same_secret("secret","secret"));assert!(!same_secret("secret","different"));
    }
    #[tokio::test] async fn capture_http_auth_pair_replay_origin_and_revocation() {
        let root=std::env::temp_dir().join(format!("capture-http-{}",Uuid::new_v4()));std::fs::create_dir_all(&root).unwrap();
        let extension="a".repeat(32);let s=Arc::new(Service { root:root.clone(),library_root:root.join("library"),notify:None,port:12345,enrich_metadata:AtomicBool::new(false),terminating:AtomicBool::new(false),enabled:AtomicBool::new(true),generation:AtomicU64::new(0),store:store::Store::open(&root.join("test.db")).unwrap(),pair:Mutex::new(Some(Pair { extension:extension.clone(),code:"one-time-code".into(),deadline:Instant::now()+Duration::from_secs(300),token:String::new(),token_deadline:Instant::now(),failures:0 })),requests:tokio::sync::Semaphore::new(8) });
        let make=|method:&str,path:&str,body:&str,origin:&str,token:&str|Request::builder().method(method).uri(path).header("host","127.0.0.1:12345").header("origin",origin).header("x-a4-extension",&extension).header("content-type","application/json").header("authorization",format!("Bearer {token}")).body(Body::from(body.to_string())).unwrap();
        let origin=format!("chrome-extension://{extension}");
        assert_eq!(handle(State(s.clone()),make("GET","/v1/captures","","https://evil.example","")).await.status(),StatusCode::FORBIDDEN);
        assert_eq!(handle(State(s.clone()),make("GET","/v1/captures","",&origin,"")).await.status(),StatusCode::UNAUTHORIZED);
        assert_eq!(handle(State(s.clone()),make("POST","/v1/pair",r#"{"code":"one-time-code"}"#,&origin,"")).await.status(),StatusCode::OK);
        assert_eq!(handle(State(s.clone()),make("POST","/v1/pair",r#"{"code":"one-time-code"}"#,&origin,"")).await.status(),StatusCode::UNAUTHORIZED);
        let token=s.pair.lock().unwrap().as_ref().unwrap().token.clone();
        assert_eq!(handle(State(s.clone()),make("POST","/v1/captures",&model::fixture().to_string(),&origin,&token)).await.status(),StatusCode::ACCEPTED);
        s.enabled.store(false,Ordering::Release);
        assert_eq!(handle(State(s.clone()),make("GET","/v1/captures","",&origin,&token)).await.status(),StatusCode::SERVICE_UNAVAILABLE);
        drop(s);std::fs::remove_dir_all(root).unwrap();
    }
}

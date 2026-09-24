//! Desktop lifecycle/consent UI; concrete AppHandle stays outside test-instantiated state.
use super::*;
use super::native_state::NativeState;
static NATIVE:OnceLock<Arc<NativeState>>=OnceLock::new();
static START_ERROR:Mutex<Option<String>>=Mutex::new(None);
pub(super) fn current_native()->Result<&'static Arc<NativeState>,String>{NATIVE.get().ok_or_else(||START_ERROR.lock().ok().and_then(|e|e.clone()).unwrap_or("原生通信组件尚未启动".into()))}
pub(super) fn status()->Value{
    match current_native(){Ok(n)=>json!({"enabled":n.allowed(),"error":START_ERROR.lock().ok().and_then(|e|e.clone()),"transport":"native_messaging","enrichMetadata":n.service.enrich_metadata.load(Ordering::Acquire),"inbox":n.service.store.list().unwrap_or(json!({"tasks":[]}))}),Err(e)=>json!({"enabled":false,"transport":"native_messaging","error":e,"inbox":{"tasks":[]}})}
}
pub fn start_native(app:&AppHandle){
    // An isolated debug window must never contend for the installed app's
    // per-user capture pipe. Release builds retain the normal startup path.
    if isolated_live_dev(&app.config().identifier) {
        if let Ok(mut error) = START_ERROR.lock() {
            *error = Some("独立开发实例已停用浏览器采集连接".into());
        }
        return;
    }
    #[cfg(windows)] {
        let app=app.clone();
        tauri::async_runtime::spawn(async move{
            if let Err(e)=initialize(app).await{if let Ok(mut error)=START_ERROR.lock(){*error=Some(e);}}
        });
    }
    #[cfg(not(windows))] {let _=app;if let Ok(mut e)=START_ERROR.lock(){*e=Some("原生采集连接目前支持Windows".into());}}
}
#[cfg(windows)]
async fn initialize(app:AppHandle)->Result<(),String>{
    let data=crate::app_paths::app_data_root(&app)?;let store_dir=data.parent().ok_or("capture_data_parent")?.join("A4CaptureData");std::fs::create_dir_all(&store_dir).map_err(|_|"capture_storage_create")?;
    // The download cache follows the configured files root (storage.rs); the small capture.db stays put.
    let root=crate::storage::capture_cache_root(&data,store_dir.clone());std::fs::create_dir_all(&root).map_err(|_|"capture_storage_create")?;
    let store=store::Store::open(&store_dir.join("capture.db"))?;
    let enabled=store.native_setting("authorized",false)?;let enrich=store.native_setting("enrich_metadata",true)?;
    let handle=app.clone();
    let service=Arc::new(Service{root,library_root:data,notify:Some(Arc::new(move|value|{let _=handle.emit("capture://library-changed",value);})),store,enrich_metadata:AtomicBool::new(enrich),terminating:AtomicBool::new(false),enabled:AtomicBool::new(enabled),generation:AtomicU64::new(0),
        #[cfg(test)] port:0,#[cfg(test)] pair:Mutex::new(None),#[cfg(test)] requests:tokio::sync::Semaphore::new(8),
    });
    let prompt=Arc::new(move||super::native_consent::prompt(&app));
    let native=Arc::new(NativeState::new(service.clone(),prompt));
    NATIVE.set(native.clone()).map_err(|_|"native_already_started")?;
    *slot().lock().map_err(|_|"capture_service_lock")?=Some(service.clone());
    tauri::async_runtime::spawn_blocking(move||worker_loop(service));
    let expected=std::env::current_exe().map_err(|_|"desktop_path_unavailable")?.parent().ok_or("desktop_path_unavailable")?.join("native-host").join("a4note-native-host.exe");
    let result=super::native_server::serve(native.clone(),super::native_windows::pipe_name()?,expected).await;
    if result.is_err(){native.service.enabled.store(false,Ordering::Release);}result
}

fn isolated_live_dev(identifier: &str) -> bool {
    cfg!(debug_assertions)
        && identifier.strip_prefix("app.aster.research.dev.").is_some_and(|suffix| !suffix.is_empty())
}

#[cfg(test)]
mod live_dev_tests {
    use super::isolated_live_dev;

    #[test]
    fn capture_skip_is_limited_to_isolated_debug_identity() {
        assert!(!isolated_live_dev("app.aster.research"));
        assert!(!isolated_live_dev("app.aster.research.dev."));
        assert!(!isolated_live_dev("unrelated.dev.integration"));
        assert_eq!(isolated_live_dev("app.aster.research.dev.integration.w123"), cfg!(debug_assertions));
    }
}

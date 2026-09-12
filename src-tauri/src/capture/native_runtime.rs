//! Desktop lifecycle/consent UI; concrete AppHandle stays outside test-instantiated state.
use super::*;
use super::native_state::NativeState;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
static NATIVE:OnceLock<Arc<NativeState>>=OnceLock::new();
static START_ERROR:Mutex<Option<String>>=Mutex::new(None);
pub(super) fn current_native()->Result<&'static Arc<NativeState>,String>{NATIVE.get().ok_or_else(||START_ERROR.lock().ok().and_then(|e|e.clone()).unwrap_or("原生通信组件尚未启动".into()))}
pub(super) fn status()->Value{
    match current_native(){Ok(n)=>json!({"enabled":n.allowed(),"error":START_ERROR.lock().ok().and_then(|e|e.clone()),"transport":"native_messaging","enrichMetadata":n.service.enrich_metadata.load(Ordering::Acquire),"inbox":n.service.store.list().unwrap_or(json!({"tasks":[]}))}),Err(e)=>json!({"enabled":false,"transport":"native_messaging","error":e,"inbox":{"tasks":[]}})}
}
pub fn start_native(app:&AppHandle){
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
    let data=crate::app_paths::app_data_root(&app)?;let root=data.parent().ok_or("capture_data_parent")?.join("A4CaptureData");std::fs::create_dir_all(&root).map_err(|_|"capture_storage_create")?;
    let store=store::Store::open(&root.join("capture.db"))?;
    let enabled=store.native_setting("authorized",false)?;let enrich=store.native_setting("enrich_metadata",true)?;
    let handle=app.clone();
    let service=Arc::new(Service{root,library_root:data,notify:Some(Arc::new(move|value|{let _=handle.emit("capture://library-changed",value);})),store,enrich_metadata:AtomicBool::new(enrich),terminating:AtomicBool::new(false),enabled:AtomicBool::new(enabled),generation:AtomicU64::new(0),
        #[cfg(test)] port:0,#[cfg(test)] pair:Mutex::new(None),#[cfg(test)] requests:tokio::sync::Semaphore::new(8),
    });
    let prompt=Arc::new(move||{
        if let Some(window)=app.get_webview_window("main"){let _=window.show();let _=window.set_focus();}
        app.dialog().message("允许 A4 Note 论文采集扩展连接此桌面软件？\n\n扩展可提交论文元数据/PDF并读取采集任务状态。授权会保存在本机，重启后无需配对；可在设置中随时撤销。外部元数据补全可在设置中关闭。")
            .title("A4 Note · 浏览器连接授权").buttons(MessageDialogButtons::OkCancelCustom("允许并记住".into(),"拒绝".into())).blocking_show()
    });
    let native=Arc::new(NativeState::new(service.clone(),prompt));
    NATIVE.set(native.clone()).map_err(|_|"native_already_started")?;
    *slot().lock().map_err(|_|"capture_service_lock")?=Some(service.clone());
    tauri::async_runtime::spawn_blocking(move||worker_loop(service));
    let expected=std::env::current_exe().map_err(|_|"desktop_path_unavailable")?.parent().ok_or("desktop_path_unavailable")?.join("native-host").join("a4note-native-host.exe");
    let result=super::native_server::serve(native.clone(),super::native_windows::pipe_name()?,expected).await;
    if result.is_err(){native.service.enabled.store(false,Ordering::Release);}result
}

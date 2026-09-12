//! Browser-launched stdio host. Never opens a library or logs to stdout.
#[path="../../../src-tauri/src/native_messaging/protocol.rs"] mod protocol;
#[cfg(windows)] #[path="../../../src-tauri/src/native_messaging/windows.rs"] mod security;
use serde_json::{json,Value};
#[tokio::main(flavor="current_thread")]
async fn main(){
    #[cfg(windows)] if let Err(e)=run().await{eprintln!("A4 Note native host: {e}");std::process::exit(1);}
    #[cfg(not(windows))] {eprintln!("Native host currently supports Windows only");std::process::exit(1);}
}
#[cfg(windows)]
async fn run()->Result<(),String>{
    use std::{sync::{Arc,atomic::{AtomicBool,Ordering}},os::windows::io::AsRawHandle,time::Duration};
    use tokio::{io::{AsyncReadExt,AsyncWriteExt},net::windows::named_pipe::ClientOptions};
    use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;
    let origin=std::env::args().nth(1).ok_or("browser_origin_required")?;
    if origin!=security::allowed_origin(){return Err("browser_origin_rejected".into());}
    let exe=std::env::current_exe().map_err(|_|"host_path_unavailable")?;
    let desktop=exe.parent().and_then(|p|p.parent()).ok_or("host_installation_invalid")?.join("a4note.exe");
    let closed=Arc::new(AtomicBool::new(false));let input_closed=closed.clone();
    let (sender,mut receiver)=tokio::sync::mpsc::channel::<Value>(8);
    std::thread::spawn(move||{let mut input=std::io::stdin().lock();while let Ok(Some(value))=protocol::read_frame(&mut input){if sender.blocking_send(value).is_err(){break;}}input_closed.store(true,Ordering::Release);});
    let mut output=std::io::stdout().lock();
    let name=security::pipe_name()?;
    #[cfg(feature="integration-test")]
    let name=std::env::var("A4NOTE_TEST_PIPE").unwrap_or(name);
    let mut pipe=None;
    while let Some(value)=receiver.recv().await {
        let request=match protocol::decode_request(value.clone()){
            Ok(request)=>request,
            Err(_)=>{
                let id=value["id"].as_u64().filter(|id|*id>0&&*id<=u32::MAX as u64).ok_or("invalid_request_id")?;
                protocol::write_frame(&mut output,&json!({"id":id,"ok":false,"error":{"code":"native_protocol_mismatch","message":"通信协议不兼容，请更新配套桌面与插件"}}))?;
                continue;
            }
        };
        let result=async {
            if pipe.is_none(){
                let candidate=ClientOptions::new().open(&name).map_err(|_|"请启动已安装的新版 A4 Note，再点击连接")?;
                let mut pid=0;
                if unsafe{GetNamedPipeServerProcessId(candidate.as_raw_handle(),&mut pid)}==0 || !security::same_executable(&security::process_path(pid)?,&desktop){return Err("通信组件与运行中的桌面版本不匹配，请退出旧版并启动已安装的新版".to_string());}
                pipe=Some(candidate);
            }
            let channel=pipe.as_mut().ok_or("desktop_unavailable")?;
            let packet=json!({"origin":origin,"request":value});let bytes=serde_json::to_vec(&packet).map_err(|_|"native_encode_failed")?;
            if bytes.len()>protocol::MAX_FRAME{return Err("native_message_size_limit".into());}
            channel.write_all(&(bytes.len() as u32).to_ne_bytes()).await.map_err(|_|"desktop_disconnected")?;
            channel.write_all(&bytes).await.map_err(|_|"desktop_disconnected")?;
            let mut prefix=[0u8;4];channel.read_exact(&mut prefix).await.map_err(|_|"desktop_disconnected")?;
            let length=u32::from_ne_bytes(prefix) as usize;if length==0||length>protocol::MAX_FRAME{return Err("desktop_message_size_limit".into());}
            let mut bytes=vec![0;length];channel.read_exact(&mut bytes).await.map_err(|_|"desktop_disconnected")?;
            serde_json::from_slice::<Value>(&bytes).map_err(|_|"desktop_invalid_json".to_string())
        };
        let response=tokio::select!{
            r=tokio::time::timeout(Duration::from_secs(185),result)=>r.unwrap_or_else(|_|Err("desktop_timeout".into())),
            _=async {while !closed.load(Ordering::Acquire){tokio::time::sleep(Duration::from_millis(100)).await;}}=>return Ok(()),
        };
        match response {
            Ok(mut v)=>{
                if v["id"]!=request.id{return Err("desktop_response_mismatch".into());}
                if request.operation==protocol::Operation::Hello && v["ok"]==true && v["result"].is_object(){
                    v["result"]["nativeHost"]=json!({"version":env!("CARGO_PKG_VERSION"),"capabilities":{"folderSelection":true}});
                }
                protocol::write_frame(&mut output,&v)?;
            },
            Err(e)=>{pipe=None;protocol::write_frame(&mut output,&json!({"id":request.id,"ok":false,"error":{"code":"desktop_unavailable","message":e}}))?;},
        }
    }
    Ok(())
}

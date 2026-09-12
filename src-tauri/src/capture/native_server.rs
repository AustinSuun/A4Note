//! Windows current-user named pipe, peer executable binding, bounded framed requests.
use super::*;
use super::native_state::{NativeState,Session};
use tokio::{io::{AsyncReadExt,AsyncWriteExt},net::windows::named_pipe::{NamedPipeServer,ServerOptions}};
use std::os::windows::io::AsRawHandle;
use windows_sys::Win32::{Security::SECURITY_ATTRIBUTES,System::Pipes::GetNamedPipeClientProcessId};
pub(super) fn create_pipe(name:&str,first:bool)->Result<NamedPipeServer,String>{
    let security=super::native_windows::Security::current_user()?;
    let mut attributes=SECURITY_ATTRIBUTES{nLength:std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,lpSecurityDescriptor:security.0,bInheritHandle:0};
    unsafe{ServerOptions::new().first_pipe_instance(first).reject_remote_clients(true).create_with_security_attributes_raw(name,(&mut attributes as *mut SECURITY_ATTRIBUTES).cast())}.map_err(|e|format!("native_pipe_create: {e}"))
}
pub(super) async fn serve(state:Arc<NativeState>,name:String,expected_host:PathBuf)->Result<(),String>{
    let mut listener=create_pipe(&name,true)?;let connections=Arc::new(tokio::sync::Semaphore::new(4));
    loop{
        tokio::select!{
            connected=listener.connect()=>connected.map_err(|_|"native_pipe_connect")?,
            _=async{while !state.service.terminating.load(Ordering::Acquire){tokio::time::sleep(Duration::from_millis(200)).await;}}=>return Ok(()),
        }
        let next=create_pipe(&name,false)?;let client=std::mem::replace(&mut listener,next);
        let Ok(permit)=connections.clone().try_acquire_owned() else{drop(client);continue;};
        let state=state.clone();let expected_host=expected_host.clone();
        tokio::spawn(async move{let _permit=permit;let _=connection(client,state,expected_host).await;});
    }
}
pub(super) async fn connection(mut pipe:NamedPipeServer,state:Arc<NativeState>,expected_host:PathBuf)->Result<(),String>{
    let mut pid=0;
    if unsafe{GetNamedPipeClientProcessId(pipe.as_raw_handle(),&mut pid)}==0||!super::native_windows::same_executable(&super::native_windows::process_path(pid)?,&expected_host){return Err("native_peer_rejected".into());}
    let session=Arc::new(Mutex::new(Session{upload:None}));
    loop{
        let value=tokio::time::timeout(Duration::from_secs(90),async{
            let mut prefix=[0u8;4];pipe.read_exact(&mut prefix).await.map_err(|_|"native_disconnected")?;
            let length=u32::from_ne_bytes(prefix) as usize;if length==0||length>super::native_protocol::MAX_FRAME{return Err("native_message_size_limit");}
            let mut bytes=vec![0;length];pipe.read_exact(&mut bytes).await.map_err(|_|"native_disconnected")?;
            serde_json::from_slice::<Value>(&bytes).map_err(|_|"native_invalid_json")
        }).await.map_err(|_|"native_idle_timeout")??;
        if value["origin"]!=super::native_windows::allowed_origin(){return Err("native_origin_rejected".into());}
        let request=super::native_protocol::decode_request(value["request"].clone())?;
        let service=state.clone();let work_session=session.clone();
        let response=tokio::task::spawn_blocking(move||{let mut s=work_session.lock().map_err(|_|"native_session_lock")?;Ok::<_,String>(service.dispatch(request,&mut s))}).await.map_err(|_|"native_worker_failed")??;
        let mut bytes=serde_json::to_vec(&response).map_err(|_|"native_encode_failed")?;
        if bytes.len()>super::native_protocol::MAX_FRAME{bytes=serde_json::to_vec(&json!({"id":response["id"],"ok":false,"error":{"code":"response_too_large","message":"任务列表过大，请在桌面查看"}})).map_err(|_|"native_encode_failed")?;}
        tokio::time::timeout(Duration::from_secs(15),async{
            pipe.write_all(&(bytes.len() as u32).to_ne_bytes()).await?;pipe.write_all(&bytes).await
        }).await.map_err(|_|"native_write_timeout")?.map_err(|_|"native_disconnected")?;
    }
}

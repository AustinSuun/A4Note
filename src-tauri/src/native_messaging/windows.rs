//! Per-user named-pipe security shared by the desktop and the independent host.
use std::{ffi::c_void, path::{Path,PathBuf}, ptr};
use windows_sys::Win32::{Foundation::{CloseHandle,LocalFree,HANDLE},Security::{GetTokenInformation,TokenUser,TOKEN_QUERY,TOKEN_USER,Authorization::{ConvertSidToStringSidW,ConvertStringSecurityDescriptorToSecurityDescriptorW}},System::Threading::{GetCurrentProcess,OpenProcessToken,OpenProcess,QueryFullProcessImageNameW,PROCESS_QUERY_LIMITED_INFORMATION}};
struct Handle(HANDLE);
impl Drop for Handle {fn drop(&mut self){unsafe{CloseHandle(self.0);}}}
pub fn user_sid()->Result<String,String>{unsafe{
    let mut token=ptr::null_mut();if OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&mut token)==0{return Err("user_token_unavailable".into());}let _token=Handle(token);
    let mut length=0;GetTokenInformation(token,TokenUser,ptr::null_mut(),0,&mut length);
    if length==0||length>65536{return Err("user_token_invalid".into());}
    let mut storage=vec![0usize;(length as usize+std::mem::size_of::<usize>()-1)/std::mem::size_of::<usize>()];
    if GetTokenInformation(token,TokenUser,storage.as_mut_ptr().cast(),length,&mut length)==0{return Err("user_token_read".into());}
    let user=&*(storage.as_ptr() as *const TOKEN_USER);let mut text=ptr::null_mut();
    if ConvertSidToStringSidW(user.User.Sid,&mut text)==0{return Err("user_sid_read".into());}
    let mut count=0;while count<256&&*text.add(count)!=0{count+=1;}
    let sid=String::from_utf16_lossy(std::slice::from_raw_parts(text,count));LocalFree(text.cast());
    if !sid.starts_with("S-")||!sid.chars().all(|c|c=='S'||c=='-'||c.is_ascii_digit()){return Err("user_sid_invalid".into());}Ok(sid)
}}
pub fn pipe_name()->Result<String,String>{Ok(format!(r"\\.\pipe\A4Note.Capture.{}",user_sid()?))}
pub struct Security(pub *mut c_void);
impl Security {pub fn current_user()->Result<Self,String>{
    let text:Vec<u16>=format!("D:P(A;;GA;;;{})(A;;GA;;;SY)",user_sid()?).encode_utf16().chain(Some(0)).collect();let mut pointer=ptr::null_mut();
    if unsafe{ConvertStringSecurityDescriptorToSecurityDescriptorW(text.as_ptr(),1,&mut pointer,ptr::null_mut())}==0{return Err("pipe_security_descriptor_failed".into());}Ok(Self(pointer))
}}
impl Drop for Security{fn drop(&mut self){unsafe{LocalFree(self.0);}}}
pub fn process_path(pid:u32)->Result<PathBuf,String>{unsafe{
    let process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,0,pid);if process.is_null(){return Err("peer_process_unavailable".into());}let _handle=Handle(process);
    let mut path=vec![0u16;32768];let mut size=path.len() as u32;
    if QueryFullProcessImageNameW(process,0,path.as_mut_ptr(),&mut size)==0{return Err("peer_path_unavailable".into());}
    Ok(PathBuf::from(String::from_utf16_lossy(&path[..size as usize])))
}}
pub fn same_executable(actual:&Path,expected:&Path)->bool{
    match (actual.canonicalize(),expected.canonicalize()){(Ok(a),Ok(b))=>a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy()),_=>false}
}
pub fn allowed_origin()->String {
    let identity:serde_json::Value=serde_json::from_str(include_str!("../../../apps/native-host/identity.json")).expect("bundled_native_identity");
    format!("chrome-extension://{}/",identity["extensionId"].as_str().expect("bundled_extension_id"))
}

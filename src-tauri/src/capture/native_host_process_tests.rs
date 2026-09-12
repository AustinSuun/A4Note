//! Real stdio host + two-way named pipe, isolated data and executable layout.
//! The alternate pipe is compiled only into a dedicated integration-test host.
use super::native_tests::{Root,service};
use super::*;
use super::native_state::NativeState;
use std::{fs,process::{Command,Stdio},io::Write};
#[test]
#[ignore = "Launched only by the isolated native host process regression"]
fn native_host_fixture_process(){
    let name=std::env::var("A4NOTE_TEST_PIPE").expect("isolated fixture required");let root=PathBuf::from(std::env::var("A4NOTE_TEST_ROOT").unwrap());
    let host=std::env::current_exe().unwrap().parent().unwrap().join("native-host/a4note-native-host.exe");
    let runtime=tokio::runtime::Runtime::new().unwrap();runtime.block_on(async{
        let n=Arc::new(NativeState::new(service(&root,false),Arc::new(||true)));
        let server=super::native_server::create_pipe(&name,true).unwrap();fs::write(root.join("ready"),b"ready").unwrap();
        server.connect().await.unwrap();let _=super::native_server::connection(server,n,host).await;
    });
}
struct Child(std::process::Child);impl Drop for Child{fn drop(&mut self){let _=self.0.kill();let _=self.0.wait();}}
#[test]
#[ignore = "Requires dedicated integration-test host build; run test:capture-native-process"]
fn native_host_real_process_roundtrip(){
    let root=Root::new();fs::create_dir_all(root.0.join("native-host")).unwrap();let desktop=root.0.join("a4note.exe");let host=root.0.join("native-host/a4note-native-host.exe");
    fs::copy(std::env::current_exe().unwrap(),&desktop).unwrap();fs::copy(std::env::var("A4NOTE_TEST_HOST").expect("dedicated test host path required"),&host).unwrap();
    let name=format!("{}-process-test-{}",super::native_windows::pipe_name().unwrap(),Uuid::new_v4());
    let mut fixture=Child(Command::new(desktop).args(["--exact","capture::native_host_process_tests::native_host_fixture_process","--ignored","--nocapture"]).env("A4NOTE_TEST_PIPE",&name).env("A4NOTE_TEST_ROOT",&root.0).stdout(Stdio::null()).spawn().unwrap());
    let deadline=Instant::now()+Duration::from_secs(10);while !root.0.join("ready").exists(){assert!(Instant::now()<deadline,"fixture start timeout");assert!(fixture.0.try_wait().unwrap().is_none(),"fixture exited");std::thread::sleep(Duration::from_millis(25));}
    let mut child=Child(Command::new(&host).arg(super::native_windows::allowed_origin()).env("A4NOTE_TEST_PIPE",&name).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap());
    let mut input=child.0.stdin.take().unwrap();let output=child.0.stdout.take().unwrap();let (sender,receiver)=std::sync::mpsc::channel();
    std::thread::spawn(move||{let mut output=output;while let Ok(Some(v))=super::native_protocol::read_frame(&mut output){if sender.send(v).is_err(){break;}}});
    for (id,op,payload) in [(1,"hello",json!({})),(2,"request_access",json!({})),(3,"submit",super::model::fixture()),(4,"list_tasks",json!({})),(5,"list_folders",json!({}))]{
        super::native_protocol::write_frame(&mut input,&json!({"id":id,"operation":op,"payload":payload})).unwrap();input.flush().unwrap();let response=receiver.recv_timeout(Duration::from_secs(10)).expect("host framed response timeout");assert_eq!(response["id"],id);assert_eq!(response["ok"],true,"{response}");if id==1{assert_eq!(response["result"]["authorized"],false);assert_eq!(response["result"]["nativeHost"]["capabilities"]["folderSelection"],true);}if id==5{assert!(response["result"]["folders"].as_array().unwrap().iter().any(|f|f["id"]=="library"));}if id==4{assert_eq!(response["result"]["tasks"].as_array().unwrap().len(),1);}
    }
    // Unknown new operations must report an error without killing the host.
    for (id,op,ok) in [(6,"future_operation",false),(7,"hello",true)] {
        super::native_protocol::write_frame(&mut input,&json!({"id":id,"operation":op})).unwrap();
        let response=receiver.recv_timeout(Duration::from_secs(10)).unwrap();assert_eq!(response["id"],id);assert_eq!(response["ok"],ok);
    }
    drop(input);let deadline=Instant::now()+Duration::from_secs(5);while child.0.try_wait().unwrap().is_none(){assert!(Instant::now()<deadline,"host EOF shutdown timeout");std::thread::sleep(Duration::from_millis(25));}
    let rejected=Command::new(&host).arg("chrome-extension://forged/").stdin(Stdio::null()).output().unwrap();assert!(!rejected.status.success());assert!(rejected.stdout.is_empty());
}

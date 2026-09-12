import {spawnSync} from 'node:child_process';
import path from 'node:path';
if(process.platform!=='win32'){console.log('Windows native process regression skipped');process.exit(0);}
function run(args,env=process.env){const result=spawnSync('cargo',args,{stdio:'inherit',env});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
const target=path.resolve('.tmp/native-host-test');
run(['build','--locked','--manifest-path','apps/native-host/Cargo.toml','--features','integration-test','--target-dir',target]);
run(['test','--manifest-path','src-tauri/Cargo.toml','--lib','capture::native_host_process_tests::native_host_real_process_roundtrip','--','--exact','--ignored','--nocapture'],{...process.env,A4NOTE_TEST_HOST:path.join(target,'debug/a4note-native-host.exe')});

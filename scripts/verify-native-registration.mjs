// Exercises the actual NSIS macros against a unique SCRATCH registry namespace.
// Never changes Chrome/Edge registrations, installed apps, or user data.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const identity=JSON.parse(await readFile('apps/native-host/identity.json','utf8'));
const extension=JSON.parse(await readFile('apps/browser-extension/manifest.json','utf8'));
const id=createHash('sha256').update(Buffer.from(extension.key,'base64')).digest('hex').slice(0,32).split('').map(c=>String.fromCharCode(97+parseInt(c,16))).join('');assert.equal(id,identity.extensionId);assert.equal(extension.key,identity.publicKey);
const config=JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8'));assert.equal(config.bundle.windows.nsis.installMode,'currentUser');assert.equal(config.bundle.windows.nsis.installerHooks,'native-host-hooks.nsh');
assert.equal(config.bundle.resources['resources/native-host/a4note-native-host.exe'],'native-host/a4note-native-host.exe');
if(process.platform!=='win32'){console.log('Native identity/config checks passed; NSIS scratch regression requires Windows');process.exit(0);}
const manifest=JSON.parse(await readFile('src-tauri/resources/native-host/host-manifest.json','utf8'));assert.deepEqual(manifest.allowed_origins,[`chrome-extension://${id}/`]);assert.equal(manifest.path,'a4note-native-host.exe');
assert.equal((await readFile('src-tauri/resources/native-host/a4note-native-host.exe')).includes(Buffer.from('A4NOTE_TEST_PIPE')),false,'Never bundle an integration-test host');
const dir=await mkdtemp(path.join(tmpdir(),'a4-native-reg-'));const namespace=`A4NoteNativeHostTest\\${randomUUID()}`;const key=`HKCU\\Software\\${namespace}`;
const hooks=(await readFile('src-tauri/native-host-hooks.nsh','utf8')).replaceAll('Software\\',`Software\\${namespace}\\`);
const chrome=`Software\\${namespace}\\Google\\Chrome\\NativeMessagingHosts\\${identity.host}`;
const edge=`Software\\${namespace}\\Microsoft\\Edge\\NativeMessagingHosts\\${identity.host}`;
const assertRegistry=(key,expected)=>`ReadRegStr $0 HKCU "${key}" ""\n\${If} $0 != "${expected}"\n SetErrorLevel 9\n Quit\n\${EndIf}\n`;
const owned='$INSTDIR\\native-host\\app.aster.research.capture.json';
let script=`Unicode true\nName "A4 Note isolated registry regression"\nOutFile "fixture.exe"\nRequestExecutionLevel user\nSilentInstall silent\n${hooks}\nSection\nStrCpy $INSTDIR "$EXEDIR\\owned"\n!insertmacro NSIS_HOOK_POSTINSTALL\n`;
for(const view of [32,64])script+=`SetRegView ${view}\n`+assertRegistry(chrome,owned)+assertRegistry(edge,owned);
script+=`WriteRegStr HKCU "${edge}" "" "other-installation"\n!insertmacro NSIS_HOOK_PREUNINSTALL\n`;
for(const view of [32,64])script+=`SetRegView ${view}\n`+assertRegistry(chrome,'')+assertRegistry(edge,'other-installation');
script+=`!insertmacro NSIS_HOOK_POSTINSTALL\n!insertmacro NSIS_HOOK_PREUNINSTALL\n`+assertRegistry(chrome,'')+assertRegistry(edge,'')+`SetErrorLevel 0\nSectionEnd\n`;
try{
  await writeFile(path.join(dir,'fixture.nsi'),script);
  const compiler=path.join(process.env.LOCALAPPDATA,'tauri/NSIS/makensis.exe');
  const compile=spawnSync(compiler,['/V2','fixture.nsi'],{cwd:dir,encoding:'utf8',timeout:30000});assert.equal(compile.status,0,compile.error?.message||compile.stdout+compile.stderr);
  const execute=spawnSync(path.join(dir,'fixture.exe'),[],{cwd:dir,timeout:30000});assert.equal(execute.status,0,execute.error?.message||'NSIS scratch ownership regression failed');
  console.log('Native identity/bundle checks and real NSIS registration/repair/ownership-safe removal passed in unique scratch HKCU namespace. Real browser registry untouched.');
}finally{spawnSync('reg.exe',['delete',key,'/f'],{stdio:'ignore'});await rm(dir,{recursive:true,force:true});}

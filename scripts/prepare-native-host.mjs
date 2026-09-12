// Reproducible host preparation. Never registers a browser or starts the desktop.
import {spawnSync} from 'node:child_process';
import {readFile,mkdir,copyFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const identity=JSON.parse(await readFile(path.join(root,'apps/native-host/identity.json'),'utf8'));
const manifest=JSON.parse(await readFile(path.join(root,'apps/browser-extension/manifest.json'),'utf8'));
const id=createHash('sha256').update(Buffer.from(identity.publicKey,'base64')).digest('hex').slice(0,32).split('').map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
if(id!==identity.extensionId||manifest.key!==identity.publicKey)throw new Error('Extension identity mismatch');
if(process.platform!=='win32'){console.log('Windows native host preparation skipped on this platform');process.exit(0);}
const debug=process.argv.includes('--debug');const option=process.argv.indexOf('--target-dir');
const target=option>=0?path.resolve(process.argv[option+1]):path.join(root,'apps/native-host/target');
const args=['build','--locked','--manifest-path',path.join(root,'apps/native-host/Cargo.toml'),'--target-dir',target,'--no-default-features',...(debug?[]:['--release'])];
const result=spawnSync('cargo',args,{cwd:root,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
const dir=path.join(root,'src-tauri/resources/native-host');await mkdir(dir,{recursive:true});
const destination=path.join(dir,'a4note-native-host.exe'),temporary=destination+'.'+process.pid+'.tmp';
await copyFile(path.join(target,debug?'debug':'release','a4note-native-host.exe'),temporary);await rename(temporary,destination);
await writeFile(path.join(dir,'host-manifest.json'),JSON.stringify({name:identity.host,description:'A4 Note local paper capture',path:'a4note-native-host.exe',type:'stdio',allowed_origins:[`chrome-extension://${id}/`]},null,2)+'\n');
console.log(`Native host prepared for ${id}; browser registration is installer-only.`);

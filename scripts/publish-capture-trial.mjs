// Publish the already-built capture trial without touching a running old latest.
import {mkdir,readFile,cp,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const stage=new URL('../.build/tauri-packaging/20260911-215929-79200/latest/',import.meta.url);
const destination=new URL('../artifacts/windows/capture-0.3.0-20260911/',import.meta.url);
const info=JSON.parse(await readFile(new URL('build-info.json',stage),'utf8'));
const hash=async url=>createHash('sha256').update(await readFile(url)).digest('hex');
for(const key of ['executable','installer'])if(await hash(new URL(info.files[key],stage))!==info.sha256[key].toLowerCase())throw new Error(`Staging hash mismatch: ${key}`);
await mkdir(destination); // No overwrite of a pre-existing release directory.
for(const key of ['executable','installer']){
 await cp(new URL(info.files[key],stage),new URL(info.files[key],destination),{force:false,errorOnExist:true});
 if(await hash(new URL(info.files[key],destination))!==info.sha256[key].toLowerCase())throw new Error(`Published hash mismatch: ${key}`);
}
info.captureExtensionVersion='0.3.0';info.releaseNote='Capture trial. Old latest remained untouched because it was in use.';
await writeFile(new URL('build-info.json',destination),JSON.stringify(info,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(info,null,2));console.log('Published to artifacts/windows/capture-0.3.0-20260911');
await rm(new URL('../',stage),{recursive:true}); // Only this completed build's isolated run directory.

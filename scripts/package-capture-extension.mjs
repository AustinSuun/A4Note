// Dependency-free, deterministic STORE ZIP; only explicitly allowed shipping files.
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const files=['manifest.json','popup.html','popup.css','popup.js','collector.js','normalize.mjs','enrich-page.mjs','bridge.mjs','native-bridge.mjs','bridge-ui.js','browser-assist.mjs','README.md','icons/16.png','icons/32.png','icons/48.png','icons/128.png'];
const source=new URL('../apps/browser-extension/',import.meta.url);
const root=new URL('../artifacts/browser-extension/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',source),'utf8'));
const table=Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=(i&1)?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
const crc=b=>{let c=0xffffffff;for(const n of b)c=table[(c^n)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
const sha=b=>createHash('sha256').update(b).digest('hex');
const chunks=[],central=[],sources={};let offset=0;
await mkdir(new URL('unpacked/',root),{recursive:true});
for(const file of files){
 const data=await readFile(new URL(file,source)),name=Buffer.from(`A4-Note-Capture/${file}`),checksum=crc(data);
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(33,12);local.writeUInt32LE(checksum,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
 const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(33,14);c.writeUInt32LE(checksum,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
 chunks.push(local,name,data);central.push(c,name);offset+=local.length+name.length+data.length;sources[file]=sha(data);
 await mkdir(new URL(`unpacked/${file.substring(0,file.lastIndexOf('/')+1)}`,root),{recursive:true});
 await cp(new URL(file,source),new URL(`unpacked/${file}`,root));
}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
const zip=Buffer.concat([...chunks,directory,end]),name=`A4-Note-Capture-${manifest.version}.zip`;
await writeFile(new URL(name,root),zip);
await writeFile(new URL('build-info.json',root),JSON.stringify({version:manifest.version,filename:name,sha256:sha(zip),sources},null,2)+'\n');
console.log(`Extension package: artifacts/browser-extension/${name}\nSHA256 ${sha(zip)}`);

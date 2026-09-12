import assert from 'node:assert/strict';
import {compareVersions,selectExtensionUpdate,fetchExtensionUpdate,RELEASE_API} from '../apps/browser-extension/extension-updates.mjs';
const fixture=()=>({tag_name:'v0.1.5',draft:false,prerelease:false,assets:[{name:'A4-Note-Capture-0.6.1.zip',browser_download_url:'https://github.com/AustinSuun/A4Note/releases/download/v0.1.5/A4-Note-Capture-0.6.1.zip',state:'uploaded',size:50000}]});
assert.equal(compareVersions('0.10.0','0.9.0'),1);assert.equal(compareVersions('1.2.3.0','1.2.3'),0);assert.throws(()=>compareVersions('bad','1.0.0'));
assert.equal(selectExtensionUpdate(fixture(),'0.6.0').available,true);assert.equal(selectExtensionUpdate(fixture(),'0.6.1').available,false);assert.equal(selectExtensionUpdate(fixture(),'0.7.0').available,false);
for(const modify of [r=>r.draft=true,r=>r.prerelease=true,r=>r.assets=[],r=>r.assets[0].browser_download_url='https://evil.test/update.zip',r=>r.assets[0].size=20*1024*1024,r=>r.assets[0].state='new']){const r=fixture();modify(r);assert.throws(()=>selectExtensionUpdate(r,'0.6.0'));}
let calls=0;const result=await fetchExtensionUpdate('0.6.0',async(url,options)=>{calls++;assert.equal(url,RELEASE_API);assert.equal(options.credentials,'omit');return new Response(JSON.stringify(fixture()));});assert.equal(calls,1);assert.equal(result.version,'0.6.1');
await assert.rejects(fetchExtensionUpdate('0.6.0',async()=>new Response('',{status:403})),/受限/);
await assert.rejects(fetchExtensionUpdate('0.6.0',async()=>new Response('x'.repeat(512*1024+1))),/过大/);
console.log('Extension update checks passed: semantic versions, no downgrade, official URL pinning, incomplete releases, bounded responses and explicit discovery. HTTP mocked; no installation.');

const {verifyDraftAssets,verifyPublishedUrls}=await import('./release-assets.mjs');
const expected=[{name:'A4.Note_x64-setup.exe',size:123,sha256:'a'.repeat(64)}];
const draft=[{...expected[0],state:'uploaded',digest:'sha256:'+'a'.repeat(64),url:'https://github.com/AustinSuun/A4Note/releases/download/untagged-123/A4.Note_x64-setup.exe'}];
verifyDraftAssets(draft,expected);
for(const change of [a=>a.size=124,a=>a.digest='sha256:bad',a=>a.state='new']){const copy=structuredClone(draft);change(copy[0]);assert.throws(()=>verifyDraftAssets(copy,expected));}
const url='https://github.com/AustinSuun/A4Note/releases/download/v0.1.5/A4.Note_x64-setup.exe';
assert.throws(()=>verifyPublishedUrls(draft,[url]));verifyPublishedUrls([{...draft[0],url}],[url]);
console.log('Release draft hashes/sizes and canonical published URLs checked independently.');

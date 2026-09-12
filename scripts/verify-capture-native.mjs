import assert from 'node:assert/strict';
import {NativeMessenger,NATIVE_HOST} from '../apps/browser-extension/native-bridge.mjs';
function event(){const listeners=new Set();return {addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f),emit:v=>{for(const f of [...listeners])f(v);},get size(){return listeners.size;}};}
function port(){return {onMessage:event(),onDisconnect:event(),sent:[],postMessage(v){this.sent.push(v);},disconnect(){this.onDisconnect.emit();}};}
assert.equal(NATIVE_HOST,'app.aster.research.capture');
const ports=[];const bridge=new NativeMessenger(()=>{const p=port();ports.push(p);return p;},()=> 'Specified native messaging host not found.');
const one=bridge.request('hello'),two=bridge.request('list_tasks');assert.equal(ports.length,1);
ports[0].onMessage.emit({id:ports[0].sent[1].id,ok:true,result:'second'});
ports[0].onMessage.emit({id:ports[0].sent[0].id,ok:true,result:'first'});
assert.deepEqual(await Promise.all([one,two]),['first','second']);
const denied=assert.rejects(bridge.request('request_access'),e=>e.code==='access_denied');
ports[0].onMessage.emit({id:ports[0].sent.at(-1).id,ok:false,error:{code:'access_denied',message:'用户拒绝授权'}});await denied;
const lost=assert.rejects(bridge.request('hello'),/未安装/);ports[0].onDisconnect.emit();await lost;assert.equal(ports[0].onMessage.size,0);
const again=bridge.request('hello');assert.equal(ports.length,2);ports[1].onMessage.emit({id:ports[1].sent[0].id,ok:true,result:'reconnected'});assert.equal(await again,'reconnected');
await assert.rejects(bridge.request('execute_shell'));await assert.rejects(bridge.request('submit',{data:'x'.repeat(1024*1024)}));
await assert.rejects(bridge.request('hello',{},5),/超时/);assert.equal(bridge.pending.size,0);
const malformed=assert.rejects(bridge.request('hello'),/格式/);ports.at(-1).onMessage.emit({id:ports.at(-1).sent.at(-1).id,ok:'yes'});await malformed;
bridge.close();assert.equal(bridge.pending.size,0);
console.log('Native transport unit checks passed: correlation, reuse, denial, disconnect, reconnect, timeout, bounds, cleanup. Browser API mocked; real host process has a separate regression.');

const frames=[];globalThis.chrome={runtime:{connectNative(){const p=port();p.postMessage=v=>{frames.push(v);queueMicrotask(()=>p.onMessage.emit({id:v.id,ok:true,result:v.operation==='pdf_begin'?{transferId:'transfer'}:{authorized:true}}));};return p;}}};
const api=await import('../apps/browser-extension/bridge.mjs');
await api.sendCapture({captureId:'test'});
await api.uploadPdf('00000000-0000-4000-8000-000000000001',0,new Blob([new Uint8Array(192*1024+17)]));
const chunks=frames.filter(f=>f.operation==='pdf_chunk');assert.equal(chunks.length,2);assert.deepEqual(chunks.map(c=>c.payload.sequence),[0,1]);assert.equal(Buffer.from(chunks[0].payload.data,'base64').length,192*1024);assert.equal(Buffer.from(chunks[1].payload.data,'base64').length,17);assert.equal(frames.at(-1).operation,'pdf_finish');api.disconnectBridge();delete globalThis.chrome;
console.log('Shipping bridge PDF chunk dispatch verified with mocked browser port.');

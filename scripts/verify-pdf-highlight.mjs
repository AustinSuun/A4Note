import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
const resolution=registerHooks({resolve(s,c,next){return next(s.startsWith('.')&&!extname(s)?s+'.ts':s,c)}});
const h=await import('../src/features/reader/pdf/pdfHighlightAppearance.ts');resolution.deregister();let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
for(const bad of [null,undefined,'',NaN,Infinity,-Infinity,{},[],true])eq(h.normalizeHighlightAppearance({opacity:bad}).opacity,22);
for(const [input,expected] of [[-10,10],[0,10],[10,10],[15,15],[22,22],[25.7,26],[35,35],[99,35]])eq(h.normalizeHighlightAppearance({opacity:input}).opacity,expected);
for(const raw of [null,'bad','null','[]','1','"red"','{"opacity":null}','{"opacity":"35"}'])eq(h.parseHighlightAppearance(raw),{opacity:22,blend:'multiply'});
eq(h.parseHighlightAppearance('{"opacity":31,"blend":"normal"}'),{opacity:31,blend:'normal'});
eq(h.normalizeHighlightAppearance({blend:'screen'}).blend,'multiply');
for(const color of ['yellow','green','blue','purple','#ff0000','#00FF00']){assert.match(h.highlightFill(color),/^#[a-f0-9]{6}$/i);checks++}
for(const bad of ['url(x)','red','transparent','#000000ff','var(--color)'])eq(h.highlightFill(bad),'#ffe579');
const position={x:10,y:20,width:30,height:2};const copy=JSON.stringify(position);eq(h.highlightRects(position),[{x:10,y:20.56,width:30,height:1.08}]);eq(JSON.stringify(position),copy);
eq(h.highlightRects({segments:[null,3,{x:1,y:2,width:-1,height:2}]}),[]);
eq(h.highlightRects({segments:[position,position]}).length,2); // Preserve distinct segments, alpha is applied to the entire SVG only.
console.log(`PDF highlight appearance: ${checks} assertions passed`);

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
const resolution=registerHooks({resolve(s,c,next){return next(s.startsWith('.')&&!extname(s)?s+'.ts':s,c)}});
const h=await import('../src/features/reader/pdf/pdfHighlightAppearance.ts');resolution.deregister();let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
for(const bad of [null,undefined,'',NaN,Infinity,-Infinity,{},[],true])eq(h.normalizeHighlightAppearance({opacity:bad}).opacity,40);
for(const [input,expected] of [[-10,10],[0,10],[10,10],[15,15],[22,22],[25.7,26],[35,35],[45,45],[60,60],[99,60]])eq(h.normalizeHighlightAppearance({opacity:input}).opacity,expected);
for(const raw of [null,'bad','null','[]','1','"red"','{"opacity":null}','{"opacity":"35"}'])eq(h.parseHighlightAppearance(raw),{opacity:40,blend:'multiply'});
// A value the user saved explicitly (including the old default 22 and old maximum 35) is never migrated to the new default.
eq(h.parseHighlightAppearance('{"opacity":22,"blend":"multiply"}'),{opacity:22,blend:'multiply'});
eq(h.parseHighlightAppearance('{"opacity":35,"blend":"normal"}'),{opacity:35,blend:'normal'});
eq(h.parseHighlightAppearance('{"opacity":31,"blend":"normal"}'),{opacity:31,blend:'normal'});
eq(h.normalizeHighlightAppearance({blend:'screen'}).blend,'multiply');
for(const color of ['yellow','green','blue','purple','#ff0000','#00FF00']){assert.match(h.highlightFill(color),/^#[a-f0-9]{6}$/i);checks++}
for(const bad of ['url(x)','red','transparent','#000000ff','var(--color)'])eq(h.highlightFill(bad),'#ffd54a');
eq(h.highlightFill(h.SELECTION_PREVIEW_COLOR),h.SELECTION_PREVIEW_FILL);
// Colour discrimination: presets composited over white / beige at the default opacity must stay apart
// (CIE76 ΔE), while black glyphs under `multiply` stay black. The old pastel set at 22% documents the baseline.
const lin=c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;
const lab=hex=>{const [r,g,b]=[1,3,5].map(i=>lin(parseInt(hex.slice(i,i+2),16)/255));const X=(0.4124*r+0.3576*g+0.1805*b)/0.95047,Y=0.2126*r+0.7152*g+0.0722*b,Z=(0.0193*r+0.1192*g+0.9505*b)/1.08883;const f=t=>t>0.008856?Math.cbrt(t):7.787*t+16/116;return [116*f(Y)-16,500*(f(X)-f(Y)),200*(f(Y)-f(Z))];};
const dE=(a,b)=>Math.hypot(...lab(a).map((v,i)=>v-lab(b)[i]));
const presets=Object.values(h.HIGHLIGHT_PRESET_FILLS);const legacy=['#ffe579','#b9e7c5','#b9cef7','#cbb7ef'];
const minPair=(fills,bg,op)=>{let m=Infinity;for(let i=0;i<fills.length;i++)for(let j=i+1;j<fills.length;j++)m=Math.min(m,dE(h.compositedHighlightColor(fills[i],bg,op),h.compositedHighlightColor(fills[j],bg,op)));return m;};
const minVsBg=(fills,bg,op)=>Math.min(...fills.map(f=>dE(h.compositedHighlightColor(f,bg,op),bg)));
for(const bg of ['#ffffff','#f5f0e6']){
  assert.ok(minPair(presets,bg,h.DEFAULT_HIGHLIGHT_OPACITY)>=10,`presets separate on ${bg}: ${minPair(presets,bg,h.DEFAULT_HIGHLIGHT_OPACITY)}`);checks++;
  assert.ok(minVsBg(presets,bg,h.DEFAULT_HIGHLIGHT_OPACITY)>=12,`presets visible on ${bg}`);checks++;
  assert.ok(minPair(legacy,bg,22)<6,`legacy pastel set at 22% was hard to tell apart on ${bg}`);checks++;
}
eq(h.compositedHighlightColor('#ffd54a','#000000',h.DEFAULT_HIGHLIGHT_OPACITY),'#000000'); // multiply never lightens black text
eq(h.compositedHighlightColor('#ffd54a','#ffffff',100),'#ffd54a');
eq(h.compositedHighlightColor('#ffd54a','#ffffff',0),'#ffffff');
eq(h.compositedHighlightColor('#ffd54a','#ffffff',50,'normal'),'#ffeaa5');
const position={x:10,y:20,width:30,height:2};const copy=JSON.stringify(position);eq(h.highlightRects(position),[{x:10,y:20,width:30,height:2.4}]);eq(JSON.stringify(position),copy);
eq(h.highlightRects({segments:[null,3,{x:1,y:2,width:-1,height:2}]}),[]);
eq(h.highlightRects({segments:[position,position]}).length,2); // Preserve distinct segments, alpha is applied to the entire SVG only.
console.log(`PDF highlight appearance: ${checks} assertions passed`);

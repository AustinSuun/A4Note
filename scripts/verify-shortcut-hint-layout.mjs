import assert from 'node:assert/strict';
import { layoutShortcutHints, hintRectsOverlap } from '../src/shared/shortcuts/hintLayout.ts';
const checks=[];const check=(v,label)=>{assert.ok(v,label);checks.push(label);};
for(const [width,height] of [[800,600],[1280,800],[360,500]]) {
  const bounds={left:8,top:8,right:width-8,bottom:height-8};
  const tools=Array.from({length:9},(_,i)=>({id:`tool-${i}`,width:46,height:20,anchor:{left:(width-306)/2+i*34,right:(width-306)/2+i*34+30,top:height-78,bottom:height-48}}));
  const zoom=Array.from({length:3},(_,i)=>({id:`zoom-${i}`,width:50,height:20,anchor:{left:width-120+i*34,right:width-90+i*34,top:10,bottom:40}}));
  const items=[...tools,...zoom,...Array.from({length:16},(_,i)=>({id:`other-${i}`,width:82,height:20}))];
  const controls=[...tools,...zoom].map(x=>x.anchor).concat({left:0,top:height-26,right:width,bottom:height});
  const positions=layoutShortcutHints(items,bounds,controls);
  check(Object.keys(positions).length===items.length,`${width}: every shortcut fits`);
  const boxes=items.map(item=>{const p=positions[item.id];return {left:p.left,top:p.top,right:p.left+item.width,bottom:p.top+item.height};});
  check(boxes.every(b=>b.left>=bounds.left&&b.top>=bounds.top&&b.right<=bounds.right&&b.bottom<=bounds.bottom),`${width}: viewport bounds`);
  check(boxes.every(b=>controls.every(c=>!hintRectsOverlap(b,c))),`${width}: never cover a control or DEV strip`);
  check(boxes.every((b,i)=>boxes.slice(i+1).every(c=>!hintRectsOverlap(b,c))),`${width}: badges never overlap`);
  check([...tools,...zoom].every(item=>positions[item.id].placement==='adjacent'),`${width}: dense tools and right-side zoom retain anchors`);
}
const control={left:100,top:700,right:130,bottom:730};
check(hintRectsOverlap(control,{left:100,top:control.bottom-30,right:148,bottom:control.bottom-10}),'regression fixture catches old bottom-minus-30 icon overlap');
console.log(`Shortcut hint layout verification passed: ${checks.length} checks`);

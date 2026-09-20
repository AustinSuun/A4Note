import assert from 'node:assert/strict';
import { nextInlineTextHeight } from '../src/features/reader/pdf/useInlineTextAutoSize.ts';
let checks=0;const eq=(a,b)=>{assert.equal(a,b);checks++};
eq(nextInlineTextHeight(98,106,1000,10.8),null); // Growth-only draft must not shrink a larger manually sized rectangle.
eq(nextInlineTextHeight(98,122,1000,10.8),12.4);
eq(nextInlineTextHeight(100,100,1000,10),null);
eq(nextInlineTextHeight(100,101,1000,10),null);
eq(nextInlineTextHeight(100,102,1000,10),10.4);
for(const invalid of [NaN,Infinity,-Infinity])for(let i=0;i<4;i++){const args=[98,122,1000,10.8];args[i]=invalid;eq(nextInlineTextHeight(...args),null)}
eq(nextInlineTextHeight(100,122,0,10),null);eq(nextInlineTextHeight(-1,122,1000,10),null);
for(const layoutPageHeight of [792,950.4,1000,1188]){const height=nextInlineTextHeight(98,122,layoutPageHeight,1);assert(Math.abs(height*layoutPageHeight/100-124)<1e-8);checks++}
console.log(`Inline text height: ${checks} assertions passed`);

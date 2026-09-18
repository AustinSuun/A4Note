import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let checks=0;
const eq=(actual,expected,label)=>{assert.equal(actual,expected,label);checks++;};
class Style { values=new Map(); getPropertyValue(k){return this.values.get(k)??'';} setProperty(k,v){this.values.set(k,v);} removeProperty(k){this.values.delete(k);} }
const node=(height,overflow='visible',parentElement=null)=>({clientHeight:height,clientTop:0,overflow,parentElement,style:new Style(),scrollTop:0,getBoundingClientRect:()=>({top:0})});
const page=node(900,'auto');const observers=[];
class ResizeObserver { constructor(fn){this.fn=fn;observers.push(this);} observe(node){this.node=node;} disconnect(){this.stopped=true;} }
const globals={ResizeObserver,document:{scrollingElement:page},getComputedStyle:node=>({overflowY:node.overflow})};
function load(file,mocks={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:id=>{if(id in mocks)return mocks[id];throw Error(id);},...globals});return exports;}
const space=load('src/shared/markdown/markdownScrollSpace.ts');
for(const [height,expected] of [[600,240],[360,144],[800,320],[0,0],[-1,0],[NaN,0],[Infinity,0]])eq(space.markdownEndSpace(height),expected,'viewport-relative end space');
eq(space.markdownCaretScrollDelta(580,600,0,600),240,'caret lower comfort edge');
eq(space.markdownCaretScrollDelta(400,420,100,600),0,'no unnecessary movement');
eq(space.markdownCaretScrollDelta(100,120,100,600),-24,'upper breathing room');
eq(space.markdownCaretScrollDelta(580,600,0,0),0,'hidden pane no scroll');
const outer=node(600,'auto'),inner=node(2000,'visible',outer);
eq(space.markdownScrollHost(inner),outer,'external scrolling');
inner.overflow='auto';eq(space.markdownScrollHost(inner),inner,'internal scrolling');inner.overflow='visible';
const dispose=space.observeMarkdownEndSpace(inner,outer);
eq(inner.style.getPropertyValue('--markdown-end-space'),'240px','observer initial measurement');
outer.clientHeight=400;observers.at(-1).fn();eq(inner.style.getPropertyValue('--markdown-end-space'),'160px','resize updates space');
outer.clientHeight=0;observers.at(-1).fn();eq(inner.style.getPropertyValue('--markdown-end-space'),'160px','hidden keepalive retains last size');
dispose();eq(inner.style.getPropertyValue('--markdown-end-space'),'','cleanup removes own variable');eq(observers.at(-1).stopped,true,'observer disconnected');
outer.clientHeight=600;
const jobs=[];const view={dom:node(1000,'visible',outer),scrollDOM:inner,hasFocus:true,state:{selection:{main:{head:5,empty:true}}},coordsAtPos:()=>({top:580,bottom:600}),requestMeasure:job=>{if(job)jobs.push(job);}};
const Plugin=load('src/features/explorer/markdownCaretComfort.ts',{'@codemirror/view':{ViewPlugin:{fromClass:C=>C}},'../../shared/markdown/markdownScrollSpace':space}).markdownCaretComfort;
const plugin=new Plugin(view);const flush=()=>{while(jobs.length){const job=jobs.shift();job.write(job.read(view));}};
eq(observers.length,1,'plugin waits for theme/layout before selecting scroll host');flush();
eq(plugin.viewport,outer,'plugin owns actual outer scroller');
const update=(event,extra={})=>plugin.update({view,state:view.state,docChanged:true,selectionSet:false,transactions:[{isUserEvent:prefix=>event===prefix||event.startsWith(prefix+'.')}],...extra});
update('input');eq(outer.scrollTop,0,'layout reads/writes deferred');flush();eq(outer.scrollTop,240,'typing follows caret');
for(const event of ['', 'select.pointer']){outer.scrollTop=0;update(event);flush();eq(outer.scrollTop,0,'external sync/pointer selection does not pull viewport');}
for(const event of ['delete','undo','redo','select']){outer.scrollTop=0;update(event);flush();eq(outer.scrollTop,240,'keyboard operation follows caret');}
outer.scrollTop=0;view.hasFocus=false;update('input');flush();eq(outer.scrollTop,0,'inactive editor never scrolls');view.hasFocus=true;
view.state.selection.main.empty=false;update('select');flush();eq(outer.scrollTop,0,'range selection not recentered');view.state.selection.main.empty=true;
update('input');plugin.destroy();flush();eq(outer.scrollTop,0,'destroy invalidates queued measurement');eq(observers.at(-1).stopped,true,'plugin disposes observer');
console.log(`PASS ${checks} Markdown end-space and caret-follow assertions (mock geometry; browser evidence is separate).`);

// Separate main/help views while keeping stable element IDs and existing consent flows.
const get=id=>document.getElementById(id);
const make=(tag,id,text)=>{const n=document.createElement(tag);if(id)n.id=id;if(text)n.textContent=text;return n;};
const main=document.querySelector('main'),footer=document.querySelector('footer'),header=document.querySelector('header');
const help=make('section','help-view');help.hidden=true;help.setAttribute('aria-label','帮助与设置');footer.before(help);
const toggle=make('button','help-toggle','⚙');toggle.className='icon-button';toggle.type='button';toggle.title='帮助与设置';toggle.setAttribute('aria-label','帮助与设置');toggle.setAttribute('aria-controls','help-view');toggle.setAttribute('aria-expanded','false');header.append(toggle);
const back=make('button','help-back','返回');back.type='button';help.append(back);
function setHelp(open,focus=true){help.hidden=!open;main.hidden=open;footer.hidden=open;get('scan').hidden=open;toggle.setAttribute('aria-expanded',String(open));if(focus){if(open)back.focus();else toggle.focus();}}
toggle.addEventListener('click',()=>setHelp(help.hidden));back.addEventListener('click',()=>setHelp(false));
help.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();setHelp(false);}});
const move=el=>{if(el)help.append(el);};
// Connection controls and paper metadata are operational information, not help.
move(get('status'));
// Keep metadata, authors, identifiers and PDF evidence in their original main-view positions.
move(get('metadata-panel')?.querySelector('p.muted'));
move(get('files')?.closest('details'));move(get('connection-help'));
move(get('folder-tree-hint'));move(get('folder-status'));move(document.querySelector('.folder-memory-row'));
move(get('tasks-panel'));move(get('extension-settings'));
const loading=make('progress','scan-progress');loading.setAttribute('aria-label','正在识别论文');main.prepend(loading);
const progress=make('section','progress-view');const tools=make('div','progress-tools');
const refresh=make('button','progress-refresh','↻');refresh.type='button';refresh.className='icon-button';refresh.title='刷新进度';refresh.setAttribute('aria-label','刷新进度');
const heading=make('h2','progress-title','下载进度');
const root=make('div','task-progress');tools.append(heading,refresh);progress.append(tools,root);progress.hidden=true;main.append(progress);
const observer=new MutationObserver(()=>{
  const message=get('status').textContent||'';
  const disconnected=get('connection-status').dataset.connected!=='true';
  toggle.dataset.attention=String(disconnected||/失败|未找到|未识别|需要|尚未完成/.test(message+' '+get('folder-status').textContent));
  toggle.title=disconnected?'连接未就绪，打开帮助与设置':'帮助、详细状态与设置';
});
observer.observe(get('connection-status'),{attributes:true,childList:true,subtree:true});observer.observe(get('status'),{childList:true,subtree:true});observer.observe(get('folder-status'),{childList:true,subtree:true});
globalThis.addEventListener('pagehide',()=>observer.disconnect(),{once:true});

// One reveal per explicit action, never per polling update. Wait for layout so
// sticky header/footer cannot cover the first progress row. Do not steal focus.
let revealFrame=0,revealEpoch=0;
export function cancelProgressReveal(){++revealEpoch;cancelAnimationFrame(revealFrame);}
export function revealProgress(){
  cancelProgressReveal();const epoch=revealEpoch;
  const leavingHelp=!help.hidden;
  if(leavingHelp)setHelp(false,false);
  revealFrame=requestAnimationFrame(()=>{
    revealFrame=requestAnimationFrame(()=>{
      if(epoch!==revealEpoch||progress.hidden||main.hidden)return;
      if(leavingHelp){progress.tabIndex=-1;progress.focus({preventScroll:true});}
      progress.scrollIntoView({block:'start',inline:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    });
  });
}
globalThis.addEventListener('pagehide',cancelProgressReveal,{once:true});

import {FOLDER_MEMORY_KEY,FOLDER_COLORS,readFolderMemory,buildFolderTree,reconcileFolderMemory,visibleFolderRows,folderGuideRails} from './folder-tree-model.mjs';

/** Popup-only view; remembers IDs, never folder names, paper data or disk paths. */
export function createFolderTree({root,selectionLabel,memoryLabel,toggleAll,locate,clearMemory,onChange,storage=globalThis.chrome?.storage?.local}){
  let model=null,memory=null,expanded=new Set(),selectedId='',focusId='',visible=[],blocked=true,loaded=false,saveSerial=0;
  let content=null,railElements=[],rowElements=new Map(),typeAhead='',typedAt=0;
  const normalMemoryText='自动记住选择和展开状态';
  const storageError=()=>{memoryLabel.textContent='记忆不可用，本次仍可选择文件夹';};
  const ready=(async()=>{
    try{const result=await storage.get(FOLDER_MEMORY_KEY);memory=readFolderMemory(result[FOLDER_MEMORY_KEY]);memoryLabel.textContent=normalMemoryText;}
    catch{storageError();}finally{loaded=true;}
  })();
  const snapshot=()=>({schemaVersion:1,selectedId,expanded:[...expanded]});
  const remember=()=>{
    memory=snapshot();const serial=++saveSerial;
    // Dispatch immediately so closing the popup does not discard a debounced save.
    try{Promise.resolve(storage.set({[FOLDER_MEMORY_KEY]:memory})).then(()=>{if(serial===saveSerial)memoryLabel.textContent=normalMemoryText;}).catch(()=>{if(serial===saveSerial)storageError();});}
    catch{storageError();}
  };
  const emphasize=id=>{
    const ancestors=model?.nodes.get(id)?.ancestors||[];
    for(const [railId,element] of railElements)element.classList.toggle('highlighted',ancestors.includes(railId));
  };
  const controls=()=>{
    root.setAttribute('aria-disabled',String(blocked));
    toggleAll.disabled=blocked||!model||!visible.some(row=>row.node.children.length);
    toggleAll.textContent=expanded.size?'全部收起':'全部展开';
    locate.hidden=!selectedId;locate.disabled=blocked||!selectedId;
    clearMemory.disabled=blocked||!loaded;
    for(const [id,element] of rowElements){element.tabIndex=!blocked&&id===focusId?0:-1;}
  };
  const selection=()=>{
    const node=model?.nodes.get(selectedId);
    selectionLabel.textContent=node?.valid?node.path:'点击文件夹选择保存位置';
    selectionLabel.title=node?.valid?node.path:'';
    selectionLabel.classList.toggle('has-selection',Boolean(node?.valid));
    for(const [id,element] of rowElements){
      const active=id===selectedId;element.setAttribute('aria-selected',String(active));element.classList.toggle('selected',active);
      element.querySelector('.folder-check').textContent=active?'✓':'';
    }
    emphasize(selectedId);controls();
  };
  const focus=(id,scroll=true)=>{
    if(!rowElements.has(id))return;focusId=id;controls();const row=rowElements.get(id);row.focus({preventScroll:true});
    if(scroll){const outer=root.getBoundingClientRect(),inner=row.getBoundingClientRect();
      if(inner.top<outer.top)root.scrollTop-=outer.top-inner.top+4;
      if(inner.bottom>outer.bottom)root.scrollTop+=inner.bottom-outer.bottom+4;
      const caret=row.querySelector('.folder-caret').getBoundingClientRect();
      if(caret.left<outer.left)root.scrollLeft-=outer.left-caret.left+6;
      if(caret.right>outer.right-160)root.scrollLeft+=caret.right-(outer.right-160);
    }
  };
  const icon=()=>{
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('folder-icon');
    const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z');svg.append(path);return svg;
  };
  const render=(restoreFocus=false)=>{
    if(!model)return;const scrollTop=root.scrollTop,scrollLeft=root.scrollLeft;
    visible=visibleFolderRows(model,expanded);if(!visible.some(row=>row.id===focusId))focusId=visible.some(row=>row.id===selectedId)?selectedId:visible[0]?.id||'';
    content=document.createElement('div');content.className='folder-tree-content';content.setAttribute('role','none');
    content.style.minWidth=`${Math.max(0,...visible.map(row=>row.node.depth))*20+150}px`;
    rowElements=new Map();railElements=[];
    for(const {id,node,pos,size} of visible){
      const row=document.createElement('div');row.className='folder-tree-row';row.dataset.folderId=id;row.style.setProperty('--depth',node.depth);
      row.setAttribute('role','treeitem');row.setAttribute('aria-level',String(node.depth+1));row.setAttribute('aria-posinset',String(pos));row.setAttribute('aria-setsize',String(size));row.title=node.path;
      if(node.children.length)row.setAttribute('aria-expanded',String(expanded.has(id)));
      const caret=document.createElement('span');caret.className='folder-caret';caret.setAttribute('aria-hidden','true');
      if(node.children.length){caret.dataset.caret='true';caret.textContent='›';caret.classList.toggle('open',expanded.has(id));}
      const name=document.createElement('span');name.className='folder-name';name.textContent=node.name;
      const check=document.createElement('span');check.className='folder-check';check.setAttribute('aria-hidden','true');row.append(caret,icon(),name,check);content.append(row);rowElements.set(id,row);
    }
    for(const node of model.invalid){const bad=document.createElement('div');bad.className='folder-tree-invalid';bad.textContent=`层级异常，不可选：${node.name}`;bad.title=node.path;content.append(bad);}
    if(!model.nodes.size){const empty=document.createElement('p');empty.className='folder-tree-empty';empty.textContent='暂无文件夹，请先在桌面创建';content.append(empty);}
    // Fixed 30px rows and 20px indent mirror the desktop library tree rhythm.
    const rails=document.createElement('div');rails.className='folder-tree-guides';rails.setAttribute('aria-hidden','true');
    for(const guide of folderGuideRails(visible)){
      const rail=document.createElement('span');rail.className='folder-guide';rail.style.background=FOLDER_COLORS[guide.depth%FOLDER_COLORS.length];
      rail.style.left=`${14+guide.depth*20}px`;rail.style.top=`${4+(guide.start+1)*30+2}px`;rail.style.height=`${(guide.end-guide.start)*30-6}px`;
      rails.append(rail);railElements.push([guide.id,rail]);
    }
    content.append(rails);root.replaceChildren(content);selection();root.scrollTop=scrollTop;root.scrollLeft=scrollLeft;
    if(restoreFocus)focus(focusId,false);
  };
  const toggle=id=>{
    if(blocked||!model?.nodes.get(id)?.children.length)return;
    if(expanded.has(id))expanded.delete(id);else expanded.add(id);
    focusId=id;remember();render(true);
  };
  const choose=id=>{
    if(blocked||!model?.nodes.get(id)?.valid)return;
    selectedId=id;focusId=id;remember();selection();focus(id);onChange();
  };
  root.addEventListener('click',event=>{
    const row=event.target.closest('[data-folder-id]');if(!row||blocked)return;
    if(event.target.closest('[data-caret]'))toggle(row.dataset.folderId);else choose(row.dataset.folderId);
  });
  root.addEventListener('focusin',event=>{const row=event.target.closest('[data-folder-id]');if(row){focusId=row.dataset.folderId;controls();}});
  root.addEventListener('pointerover',event=>{const row=event.target.closest('[data-folder-id]');if(row&&!blocked)emphasize(row.dataset.folderId);});
  root.addEventListener('pointerleave',()=>emphasize(selectedId));
  root.addEventListener('keydown',event=>{
    const row=event.target.closest('[data-folder-id]');if(!row||blocked)return;
    const id=row.dataset.folderId,node=model.nodes.get(id),index=visible.findIndex(item=>item.id===id);
    if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key))event.preventDefault();
    if(event.key==='ArrowDown')focus(visible[Math.min(index+1,visible.length-1)].id);
    else if(event.key==='ArrowUp')focus(visible[Math.max(index-1,0)].id);
    else if(event.key==='Home')focus(visible[0].id);
    else if(event.key==='End')focus(visible.at(-1).id);
    else if(event.key==='ArrowRight'&&node.children.length){if(!expanded.has(id))toggle(id);else focus(node.children[0]);}
    else if(event.key==='ArrowLeft'){if(node.children.length&&expanded.has(id))toggle(id);else if(node.parentId)focus(node.parentId);}
    else if(event.key==='Enter'||event.key===' ')choose(id);
    else if(event.key.length===1&&!event.ctrlKey&&!event.altKey&&!event.metaKey){
      const now=Date.now();typeAhead=now-typedAt>700?event.key:typeAhead+event.key;typedAt=now;
      const candidates=[...visible.slice(index+1),...visible.slice(0,index+1)];const next=candidates.find(item=>item.node.name.toLocaleLowerCase().startsWith(typeAhead.toLocaleLowerCase()));if(next)focus(next.id);
    }
  });
  toggleAll.addEventListener('click',()=>{
    if(blocked||!model)return;
    expanded=expanded.size?new Set():new Set([...model.nodes.values()].filter(node=>node.valid&&node.children.length).map(node=>node.id));remember();render();
  });
  locate.addEventListener('click',()=>{
    if(blocked||!model?.nodes.get(selectedId)?.valid)return;
    for(const id of model.nodes.get(selectedId).ancestors)expanded.add(id);focusId=selectedId;remember();render();focus(selectedId);
  });
  clearMemory.addEventListener('click',()=>{
    if(blocked||!loaded)return;selectedId='';expanded=new Set(model?.roots.filter(id=>model.nodes.get(id).children.length)||[]);remember();render();onChange();
  });
  return {
    ready,
    get value(){return model?.nodes.get(selectedId)?.valid?selectedId:'';},
    set disabled(value){blocked=Boolean(value);controls();},
    placeholder(text){model=null;selectedId='';focusId='';visible=[];rowElements.clear();railElements=[];const p=document.createElement('p');p.className='folder-tree-empty';p.textContent=text;root.replaceChildren(p);selection();},
    setFolders(rows){
      const next=buildFolderTree(rows),state=reconcileFolderMemory(next,memory);model=next;selectedId=state.selectedId;expanded=state.expanded;
      if(state.missingSelection)remember();render();
      return {count:model.nodes.size,invalid:model.invalid.length,restored:Boolean(selectedId),missingSelection:state.missingSelection};
    }
  };
}

/** ID-only library tree model. No filesystem access and no implicit fallback target. */
export const FOLDER_MEMORY_KEY='a4note.capture.folderTree.v1';
export const FOLDER_COLORS=['#d4777c','#dc9d55','#c3b652','#68a58b','#6791ba','#a17fb0'];
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=256&&!/[\u0000-\u001f\u007f]/.test(id);
export function readFolderMemory(value){
  if(!value||value.schemaVersion!==1||!Array.isArray(value.expanded))return null;
  return {selectedId:validId(value.selectedId)?value.selectedId:'',expanded:[...new Set(value.expanded.slice(0,2000).filter(validId))]};
}
export function buildFolderTree(rows){
  if(!Array.isArray(rows)||rows.length>2000)throw new Error('分类列表无效，请更新桌面软件');
  const nodes=new Map(),roots=[],invalid=[];
  for(const row of rows){
    if(!row||!validId(row.id)||typeof row.name!=='string'||nodes.has(row.id))throw new Error('分类列表格式不正确');
    nodes.set(row.id,{id:row.id,name:row.name,parentId:row.parentId||null,children:[],ancestors:[],depth:0,path:'',valid:false});
  }
  for(const node of nodes.values()){
    let cursor=node,valid=true;const chain=[],seen=new Set();
    while(cursor){
      if(seen.has(cursor.id)||chain.length>=64){valid=false;break;}
      seen.add(cursor.id);chain.unshift(cursor);
      if(cursor.parentId===null)break;
      cursor=nodes.get(cursor.parentId);if(!cursor){valid=false;break;}
    }
    node.valid=valid;node.path=chain.map(n=>n.name).join(' / ');
    node.ancestors=chain.slice(0,-1).map(n=>n.id);node.depth=chain.length-1;
    if(!valid)invalid.push(node);
  }
  // Keep the desktop API's stable order rather than sorting whole paths.
  for(const node of nodes.values())if(node.valid){
    if(node.parentId===null)roots.push(node.id);else nodes.get(node.parentId).children.push(node.id);
  }
  return {nodes,roots,invalid};
}
export function reconcileFolderMemory(model,memory){
  const previous=memory?.selectedId||'';
  const selectedId=model.nodes.get(previous)?.valid?previous:'';
  const expanded=new Set((memory?memory.expanded:model.roots).filter(id=>model.nodes.get(id)?.valid&&model.nodes.get(id).children.length));
  return {selectedId,expanded,missingSelection:Boolean(previous&&!selectedId)};
}
export function visibleFolderRows(model,expanded){
  const result=[],stack=model.roots.map((id,index)=>({id,pos:index+1,size:model.roots.length})).reverse();
  while(stack.length){
    const item=stack.pop(),node=model.nodes.get(item.id);result.push({...item,node});
    if(expanded.has(node.id))for(let i=node.children.length-1;i>=0;i--)stack.push({id:node.children[i],pos:i+1,size:node.children.length});
  }
  return result;
}
export function folderGuideRails(rows){
  const rails=[],stack=[];
  const finish=end=>{const start=stack.pop();if(end>start)rails.push({id:rows[start].id,depth:rows[start].node.depth,start,end});};
  for(let i=0;i<rows.length;i++){
    while(stack.length&&rows[stack.at(-1)].node.depth>=rows[i].node.depth)finish(i-1);
    stack.push(i);
  }
  while(stack.length)finish(rows.length-1);
  return rails;
}

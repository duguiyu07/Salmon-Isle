import type {Node as ProseNode} from '@milkdown/kit/prose/model';
import {EditorState,Plugin,PluginKey,Selection,type Transaction} from '@milkdown/kit/prose/state';
import {Decoration,DecorationSet} from '@milkdown/kit/prose/view';
import {closeHistory} from '@milkdown/kit/prose/history';

interface TabState {active:number;id:string}
export const visualTabsKey=new PluginKey<Map<number,TabState>>('salmon-visual-tabs');
let nextTabsId=0;
export function tabChildren(node:ProseNode,position:number){
  const tabs:{node:ProseNode;position:number;childIndex:number}[]=[];
  node.forEach((child,offset,childIndex)=>{if(child.type.name==='salmon_tab')tabs.push({node:child,position:position+1+offset,childIndex});});
  return tabs;
}
function tabStates(doc:ProseNode,old=new Map<number,TabState>()){
  const result=new Map<number,TabState>();
  doc.descendants((node,position)=>{
    if(node.type.name!=='salmon_tabs')return;
    const count=tabChildren(node,position).length,previous=old.get(position);
    result.set(position,{id:previous?.id||`editor-tabs-${++nextTabsId}`,active:Math.max(0,Math.min(previous?.active||0,count-1))});
  });
  return result;
}
/** UI-only state: hidden panels remain in the document and in undo history. */
export function visualTabsPlugin(){return new Plugin({
  key:visualTabsKey,
  state:{
    init:(_config,state)=>tabStates(state.doc),
    apply(tr,previous){
      const mapped=new Map<number,TabState>();
      previous.forEach((value,position)=>{const next=tr.mapping.mapResult(position,1);if(!next.deleted)mapped.set(next.pos,value);});
      const requested=tr.getMeta(visualTabsKey) as {position:number;index:number}|undefined;
      if(requested&&previous.has(requested.position)&&!mapped.has(requested.position))mapped.set(requested.position,previous.get(requested.position)!);
      const result=tabStates(tr.doc,mapped);
      if(tr.selectionSet){
        const $from=tr.selection.$from;
        for(let depth=1;depth<=$from.depth;depth++){
          if($from.node(depth).type.name!=='salmon_tabs')continue;
          const position=$from.before(depth),entry=result.get(position);
          const index=tabChildren($from.node(depth),position).findIndex(tab=>tr.selection.from>=tab.position&&tr.selection.from<tab.position+tab.node.nodeSize);
          if(entry&&index>=0)entry.active=index;
        }
      }
      if(requested){const entry=result.get(requested.position),node=tr.doc.nodeAt(requested.position);if(entry&&node)entry.active=Math.max(0,Math.min(requested.index,tabChildren(node,requested.position).length-1));}
      return result;
    },
  },
  props:{decorations(state){
    const decorations:Decoration[]=[];
    visualTabsKey.getState(state)?.forEach((entry,position)=>{
      const node=state.doc.nodeAt(position);if(!node)return;
      decorations.push(Decoration.node(position,position+node.nodeSize,{'data-active-tab':String(entry.active),'data-tabs-id':entry.id}));
      tabChildren(node,position).forEach((tab,index)=>decorations.push(Decoration.node(tab.position,tab.position+tab.node.nodeSize,{
        id:`${entry.id}-panel-${index}`,role:'tabpanel','aria-labelledby':`${entry.id}-tab-${index}`,
        ...(index===entry.active?{}:{'data-tab-hidden':'true','aria-hidden':'true',hidden:'hidden'}),
      })));
    });
    return DecorationSet.create(state.doc,decorations);
  }},
});}

export function tabContext(state:EditorState,position:number){
  let groupPosition=position,node=state.doc.nodeAt(position);
  if(node?.type.name!=='salmon_tabs'){
    const resolved=state.doc.resolve(Math.max(0,Math.min(position,state.doc.content.size)));
    node=null;
    for(let depth=resolved.depth;depth>0;depth--)if(resolved.node(depth).type.name==='salmon_tabs'){groupPosition=resolved.before(depth);node=resolved.node(depth);break;}
  }
  if(!node||node.type.name!=='salmon_tabs')return null;
  const tabs=tabChildren(node,groupPosition);
  const selected=tabs.findIndex(tab=>position>=tab.position&&position<tab.position+tab.node.nodeSize);
  const index=selected>=0?selected:visualTabsKey.getState(state)?.get(groupPosition)?.active||0;
  return {node,position:groupPosition,tabs,index};
}
function enterTab(tr:Transaction,groupPosition:number,index:number){
  const group=tr.doc.nodeAt(groupPosition);if(!group)return tr;
  const tab=tabChildren(group,groupPosition)[index];
  if(tab)tr.setSelection(Selection.near(tr.doc.resolve(tab.position+1)));
  return tr.setMeta(visualTabsKey,{position:groupPosition,index}).scrollIntoView();
}
export function activateTab(state:EditorState,position:number,index:number){
  return enterTab(state.tr,position,index).setMeta('addToHistory',false);
}
export type TabAction='add'|'left'|'right'|'delete';
export function tabTransaction(state:EditorState,position:number,action:TabAction){
  const context=tabContext(state,position);if(!context)return null;
  const {node,tabs,index}=context,groupPosition=context.position;
  if(action==='add'){
    const names=new Set(tabs.map(tab=>tab.node.attrs.attributes.title));let number=tabs.length+1;
    while(names.has(`标签 ${number}`))number++;
    const tab=state.schema.nodes.salmon_tab.create({attributes:{title:`标签 ${number}`}},state.schema.nodes.paragraph.create());
    return enterTab(closeHistory(state.tr.insert(groupPosition+node.nodeSize-1,tab)),groupPosition,tabs.length);
  }
  const selected=tabs[index];if(!selected)return null;
  if(action==='delete'){
    if(tabs.length<=1)return null;
    return enterTab(closeHistory(state.tr.delete(selected.position,selected.position+selected.node.nodeSize)),groupPosition,Math.min(index,tabs.length-2));
  }
  const next=index+(action==='left'?-1:1);if(next<0||next>=tabs.length)return null;
  const children:ProseNode[]=[];node.forEach(child=>children.push(child));
  [children[tabs[index].childIndex],children[tabs[next].childIndex]]=[children[tabs[next].childIndex],children[tabs[index].childIndex]];
  return enterTab(closeHistory(state.tr.replaceWith(groupPosition+1,groupPosition+node.nodeSize-1,children)),groupPosition,next);
}
export function deleteBlockTransaction(state:EditorState,position:number){
  const node=state.doc.nodeAt(position);if(!node)return null;
  if(node.type.name==='salmon_tab')return tabTransaction(state,position,'delete');
  const tr=closeHistory(state.tr.delete(position,position+node.nodeSize));
  if(!tr.doc.childCount)tr.insert(0,state.schema.nodes.paragraph.create());
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(position,tr.doc.content.size))));
  return tr.scrollIntoView();
}

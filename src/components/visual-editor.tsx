'use client';
import { forwardRef,useEffect,useImperativeHandle,useRef,useState,useLayoutEffect } from 'react';
import {createPortal} from 'react-dom';
import { Editor,rootCtx,defaultValueCtx,editorViewCtx,editorViewOptionsCtx,commandsCtx } from '@milkdown/kit/core';
import { insertTableCommand } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { $prose } from '@milkdown/kit/utils';
import { wrapIn } from '@milkdown/kit/prose/commands';
import { wrapInList,liftListItem } from '@milkdown/kit/prose/schema-list';
import { undo,redo } from '@milkdown/kit/prose/history';
import { NodeSelection,Plugin,TextSelection,type SelectionBookmark } from '@milkdown/kit/prose/state';
import { Slice } from '@milkdown/kit/prose/model';
import {addRowAfter,addColumnAfter,deleteRow,deleteColumn} from '@milkdown/kit/prose/tables';
import { visualSyntax,configureCodeSchema,parseVisualMarkdown,serializeVisualMarkdown } from '@/lib/visual-schema';
import { parseCodeMeta,serializeCodeMeta } from '@/lib/code-block';
import { visualNodeViews } from './visual-nodeviews';
import { editorInsertions } from '@/lib/editor-insertions';
import { updateGroupAttributes } from '@/lib/styles';
import { deleteBlockTransaction,tabContext,tabTransaction,visualTabsPlugin,moveBlocksTransaction,deleteSelectionBlocks,groupSelectionTransaction,type TabAction } from '@/lib/visual-blocks';
import type {EditorAnchor} from '@/lib/editor-ui';
import {configureLiveMarkdown,liveCommonmark,liveGfm,liveSyntax,liveMarkdownPlugin,liveShortcut,formatInline,headingTransaction,type InlineFormat} from '@/lib/live-markdown';
import {clipboardMarkdown} from '@/lib/editor-clipboard';
import {Bold,Italic,Code2,ArrowUp,ArrowDown,Trash2,Layers,ChevronDown,PanelsTopLeft,Columns2,Images,SquareCode,CodeXml,Sigma,Table2,ListTodo,Quote} from 'lucide-react';

export interface VisualBlock {name:string;attrs:Record<string,string>;position:number;explicit:boolean;parents:{name:string;position:number}[];tab?:{index:number;count:number};rect?:{top:number;bottom:number;left:number;right:number}}
export interface VisualEditorHandle {moveBlock:(direction:-1|1)=>void;deleteSelectionBlocks:()=>void;groupSelection:()=>void;canMove:(direction:-1|1)=>boolean;canGroup:()=>boolean;canDeleteSelection:()=>boolean;insert:(markdown:string)=>void;format:(name:string,value?:string)=>void;updateBlock:(patch:Record<string,string>)=>void;selectBlock:(position:number)=>void;deleteBlock:()=>void;tabAction:(action:TabAction)=>void;focus:()=>void;rememberSelection:()=>void}
const slashItems=editorInsertions;
const insertionIcons={group:Layers,details:ChevronDown,tabs:PanelsTopLeft,columns:Columns2,gallery:Images,code:SquareCode,html:CodeXml,math:Sigma,table:Table2,task:ListTodo,quote:Quote};
export const VisualEditor=forwardRef<VisualEditorHandle,{value:string;onChange:(value:string)=>void;onSelect:(block:VisualBlock|null,open?:boolean)=>void;onPaste:(file:File)=>void;onBlankLine?:(anchor:EditorAnchor|null)=>void}>(function VisualEditor({value,onChange,onSelect,onPaste,onBlankLine},ref){
  const host=useRef<HTMLDivElement>(null);const shell=useRef<HTMLDivElement>(null);const instance=useRef<Editor|null>(null);const callbacks=useRef({onChange,onSelect,onPaste,onBlankLine});callbacks.current={onChange,onSelect,onPaste,onBlankLine};
  const bookmark=useRef<SelectionBookmark|null>(null),requestSettings=useRef(false),slashDismissed=useRef('');
  const source=useRef(value);const suppress=useRef(false);const selected=useRef<VisualBlock|null>(null);const[error,setError]=useState('');const[ready,setReady]=useState(false);
  const pendingInsert=useRef<string[]>([]);
  const[menu,setMenu]=useState<{from:number;to:number;query:string;top:number;left:number;index:number}|null>(null);const menuRef=useRef(menu);menuRef.current=menu;
  const[bubble,setBubble]=useState<{top:number;bottom:number;left:number;right:number}|null>(null);const bubbleRef=useRef<HTMLDivElement>(null);
  const[bubbleDocked,setBubbleDocked]=useState(false);const bubbleSelection=useRef('');
  const actions=useRef<VisualEditorHandle>(null!);const chooseRef=useRef<(index:number)=>void>(()=>{});
  const editableBlock=(name:string)=>['image','code_block','table','salmon_group','salmon_details','salmon_tabs','salmon_tab','salmon_columns','salmon_column','salmon_gallery','salmon_figure','salmon_math','salmon_inline_math','salmon_html','salmon_raw_block'].includes(name);
  function view(){const editor=instance.current;return editor?.status==='Created'?editor.ctx.get(editorViewCtx):undefined;}
  function selection(open=false){const v=view();if(!v)return;const s=v.state.selection;let node=s instanceof NodeSelection?s.node:null;let position=s.from;const singleTab=node?.type.name==='salmon_tab';
    if(node?.type.name==='image'){for(let depth=s.$from.depth;depth>0;depth--)if(s.$from.node(depth).type.name==='salmon_figure'){node=s.$from.node(depth);position=s.$from.before(depth);break;}}
    if(!node||!editableBlock(node.type.name)){node=null;for(let depth=s.$from.depth;depth>0;depth--){const ancestor=s.$from.node(depth);if(editableBlock(ancestor.type.name)){node=ancestor;position=s.$from.before(depth);break;}}}
    if(node?.type.name==='salmon_tab'){const context=tabContext(v.state,position);if(context){node=context.node;position=context.position;}}
    let block:VisualBlock|null=null;
    if(node){const name=node.type.name.replace(/^salmon_/,'').replace('code_block','code');let attrs=node.attrs.attributes||node.attrs;
      if(name==='code'){const o=parseCodeMeta(node.attrs.meta);attrs={language:node.attrs.language,lineNumbers:String(o.lineNumbers),start:String(o.start),highlight:o.highlight,blur:o.blur};}
      if(name==='figure')attrs={...attrs,...(node.firstChild?.firstChild?.type.name==='image'?node.firstChild.firstChild.attrs:{})};
      const dom=v.nodeDOM(position);const element=dom instanceof HTMLElement?dom:dom?.parentElement;const rect=element?.getBoundingClientRect();
      const parents:VisualBlock['parents']=[];const resolved=v.state.doc.resolve(position);
      for(let depth=resolved.depth;depth>0;depth--)if(editableBlock(resolved.node(depth).type.name))parents.push({name:resolved.node(depth).type.name.replace(/^salmon_/,''),position:resolved.before(depth)});
      const tabs=['tabs','tab'].includes(name)?tabContext(v.state,position):null;
      block={name,attrs:{...attrs},position,explicit:s instanceof NodeSelection,parents,...(tabs?{tab:{index:tabs.index,count:tabs.tabs.length}}:{}),rect:rect?{top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right}:undefined};}
    if(block)block.parents=block.parents.filter(parent=>parent.name!=='tab');
    selected.current=block;callbacks.current.onSelect(block,open&&!singleTab);
    const blocked=Array.from({length:s.$from.depth},(_,index)=>s.$from.node(index+1).type.name).some(name=>['table','table_cell','table_header','code_block'].includes(name));
    if(v.hasFocus()&&s.empty&&s.$from.parent.type.name==='paragraph'&&s.$from.parent.content.size===0&&!blocked){
      const coords=v.coordsAtPos(s.from),rect=v.dom.getBoundingClientRect();
      callbacks.current.onBlankLine?.({top:coords.top,bottom:coords.bottom,left:rect.left,right:rect.right});
    }else callbacks.current.onBlankLine?.(null);
    const text=s.$from.parent.isTextblock?s.$from.parent.textBetween(0,s.$from.parentOffset):'';
    const slash=s.empty&&/^\/[^\s/]*$/.test(text)&&s.$from.parent.type.name==='paragraph'&&slashDismissed.current!==`${s.from}:${text}`;
    if(slash&&shell.current){const rect=shell.current.getBoundingClientRect();const c=v.coordsAtPos(s.from);setMenu(old=>({from:s.$from.start(),to:s.from,query:text.slice(1),top:(c.bottom+260>window.innerHeight?Math.max(12,c.top-260):c.bottom+8)-rect.top,left:Math.max(12,Math.min(c.left,window.innerWidth-252))-rect.left,index:old?.query===text.slice(1)?old.index:0}));}else setMenu(null);
    if(v.hasFocus()&&!s.empty&&s instanceof TextSelection&&shell.current){const key=s.from+':'+s.to;if(key!==bubbleSelection.current){bubbleSelection.current=key;setBubbleDocked(false);}const native=window.getSelection();const rectangles=native?.rangeCount&&v.dom.contains(native.anchorNode)?Array.from(native.getRangeAt(0).getClientRects()).filter(rect=>rect.width&&rect.height):[];const first=rectangles[0]||v.coordsAtPos(s.from),last=rectangles.at(-1)||v.coordsAtPos(s.to);setBubble({top:Math.min(first.top,last.top),bottom:Math.max(first.bottom,last.bottom),left:first.left,right:first.right});}else {setBubble(null);setBubbleDocked(false);bubbleSelection.current='';}
  }
  useLayoutEffect(()=>{const root=bubbleRef.current;if(!root||!bubble)return;if(bubbleDocked){root.style.visibility='visible';return;}const width=root.offsetWidth,height=root.offsetHeight;const minTop=Math.max(12,document.querySelector('.writing-toolbar')?.getBoundingClientRect().bottom||0)+8;const above=bubble.top-height-8,below=bubble.bottom+8;const top=above>=minTop?above:below+height<=window.innerHeight-12?below:-1;if(top<0&&document.querySelector('.editor-panel-dock')){setBubbleDocked(true);return;}root.style.visibility='visible';root.style.top=Math.max(minTop,top)+'px';root.style.left=Math.max(12,Math.min((bubble.left+bubble.right-width)/2,window.innerWidth-width-12))+'px';},[bubble,bubbleDocked]);
  const applyAction=(tr:any)=>{const v=view();if(v&&tr){v.dispatch(tr);v.focus();selection();}};
  actions.current={
    moveBlock(direction){const v=view();if(v)applyAction(moveBlocksTransaction(v.state,direction));},
    deleteSelectionBlocks(){const v=view();if(v)applyAction(deleteSelectionBlocks(v.state));},
    groupSelection(){const v=view();if(v)applyAction(groupSelectionTransaction(v.state));},
    canMove(direction){const v=view();return !!v&&!!moveBlocksTransaction(v.state,direction);},
    canGroup(){const v=view();return !!v&&!!groupSelectionTransaction(v.state);},
    canDeleteSelection(){const v=view();return !!v&&!!deleteSelectionBlocks(v.state);},
    insert(markdown){const editor=instance.current;if(!editor||editor.status!=='Created'){pendingInsert.current.push(markdown);return;}try{editor.action(ctx=>{const v=ctx.get(editorViewCtx);if(bookmark.current){try{v.dispatch(v.state.tr.setSelection(bookmark.current.resolve(v.state.doc)));}finally{bookmark.current=null;}}const parsed=parseVisualMarkdown(ctx,markdown);const content=parsed.childCount===1&&parsed.firstChild?.type.name==='paragraph'?parsed.firstChild.content:parsed.content;const tr=v.state.tr.replaceSelection(new Slice(content,0,0));
      const first=parsed.firstChild;if(first?.type.name==='salmon_tabs'){
        let position=-1;tr.doc.descendants((node,pos)=>{if(node===first)position=pos;});
        if(position>=0)tr.setSelection(TextSelection.near(tr.doc.resolve(position+2)));
      }else if(first?.type.name==='salmon_html'){
        tr.doc.descendants((node,pos)=>{if(node===first)tr.setSelection(NodeSelection.create(tr.doc,pos));});
      }
      v.dispatch(tr.scrollIntoView());v.focus();});}catch(e){setError(`无法插入区块：${(e as Error).message}`);}},
    format(name,value){const v=view();if(!v)return;const state=v.state;const dispatch=v.dispatch.bind(v);const schema=state.schema;
      if(name==='undo')undo(state,dispatch);else if(name==='redo')redo(state,dispatch);
      else if(['strong','emphasis','strike_through','inlineCode','inlineMath'].includes(name)){const tr=formatInline(state,name as InlineFormat);if(tr)dispatch(tr);}
      else if(name==='heading'){const tr=headingTransaction(state,Number(value)||0);if(tr)dispatch(tr);}
      else if(name==='bullet'||name==='ordered'){const type=schema.nodes[name==='bullet'?'bullet_list':'ordered_list'];if(type&&!wrapInList(type)(state,dispatch))liftListItem(schema.nodes.list_item)(state,dispatch);}
      else if(name==='quote')wrapIn(schema.nodes.blockquote)(state,dispatch);
      else if(name==='table')instance.current?.action(ctx=>ctx.get(commandsCtx).call(insertTableCommand.key,{row:3,col:3}));
      else if(['addRow','addColumn','deleteRow','deleteColumn'].includes(name)){const command={addRow:addRowAfter,addColumn:addColumnAfter,deleteRow,deleteColumn}[name as 'addRow'];command(state,dispatch);}
      else if(name==='link'&&value){const href=value.trim();if(/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href)&&state.selection.$from.sameParent(state.selection.$to)){const text=state.doc.textBetween(state.selection.from,state.selection.to)||href;dispatch(state.tr.insertText(`[${text}](${href})`));}}
      v.focus();
    },
    updateBlock(patch){const v=view();const block=selected.current;if(!v||!block)return;const node=v.state.doc.nodeAt(block.position);if(!node)return;let attrs:Record<string,any>;
      if(block.name==='code'){const options={...block.attrs,...patch};attrs={...node.attrs,language:options.language||'text',meta:serializeCodeMeta({lineNumbers:options.lineNumbers!=='false',start:Math.max(1,Number(options.start)||1),highlight:options.highlight||'',blur:options.blur||''})};}
      else if(block.name==='figure'&&Object.keys(patch).some(k=>['src','alt','title'].includes(k))){const image=node.firstChild?.firstChild;if(image?.type.name==='image'){const tr=v.state.tr.setNodeMarkup(block.position+2,undefined,{...image.attrs,...patch});if(block.explicit)tr.setSelection(NodeSelection.create(tr.doc,block.position));v.dispatch(tr);}selection();return;}
      else if(node.attrs.attributes){const next=block.name==='group'?updateGroupAttributes(node.attrs.attributes,patch):{...node.attrs.attributes,...patch};for(const key of Object.keys(next))if(next[key]==='')delete next[key];attrs={...node.attrs,attributes:next};}
      else attrs={...node.attrs,...patch};
      const tr=v.state.tr.setNodeMarkup(block.position,undefined,attrs);if(block.explicit)tr.setSelection(NodeSelection.create(tr.doc,block.position));v.dispatch(tr);selection();
    },
    selectBlock(position){const v=view();if(!v||!v.state.doc.nodeAt(position))return;v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc,position)));selection();},
    deleteBlock(){const v=view(),block=selected.current;if(!v||!block)return;const tr=deleteBlockTransaction(v.state,block.position);if(tr){v.dispatch(tr);v.focus();}},
    tabAction(action){const v=view(),block=selected.current;if(!v||!block)return;const tr=tabTransaction(v.state,block.position,action);if(tr){v.dispatch(tr);v.focus();}},
    focus(){view()?.focus();selection();},
    rememberSelection(){const v=view();if(v)bookmark.current=v.state.selection.getBookmark();},
  };
  useImperativeHandle(ref,()=>({moveBlock:direction=>actions.current.moveBlock(direction),deleteSelectionBlocks:()=>actions.current.deleteSelectionBlocks(),groupSelection:()=>actions.current.groupSelection(),canMove:direction=>actions.current.canMove(direction),canGroup:()=>actions.current.canGroup(),canDeleteSelection:()=>actions.current.canDeleteSelection(),insert:text=>actions.current.insert(text),format:(name,value)=>actions.current.format(name,value),updateBlock:patch=>actions.current.updateBlock(patch),selectBlock:position=>actions.current.selectBlock(position),deleteBlock:()=>actions.current.deleteBlock(),tabAction:action=>actions.current.tabAction(action),focus:()=>actions.current.focus(),rememberSelection:()=>actions.current.rememberSelection()}),[]);
  const items=menu?slashItems.filter(x=>x.label.includes(menu.query)||x.key.includes(menu.query.toLowerCase())):[];
  chooseRef.current=index=>{const current=menuRef.current;const v=view();if(!current||!v)return;const list=slashItems.filter(x=>x.label.includes(current.query)||x.key.includes(current.query.toLowerCase()));const item=list[index];if(!item)return;v.dispatch(v.state.tr.delete(current.from,current.to));setMenu(null);actions.current.insert(item.markdown);};
  useEffect(()=>{
    let disposed=false;let mounted=false;
    const observer=$prose(context=>new Plugin({state:{init:()=>null,apply(tr){requestSettings.current=!!tr.getMeta('salmon-open-block');if(bookmark.current)bookmark.current=bookmark.current.map(tr.mapping);return null;}},view:()=>({update(v,previous){
      if(!mounted||suppress.current)return;
      if(!v.state.doc.eq(previous.doc)){try{const markdown=serializeVisualMarkdown(context,v.state.doc);source.current=markdown;callbacks.current.onChange(markdown);setError('');}catch(e){setError(`内容暂无法转换为 Markdown：${(e as Error).message}`);}}
      if(requestSettings.current||!v.state.selection.eq(previous.selection)||!v.state.doc.eq(previous.doc))selection(requestSettings.current);
    }})}));
    const editor=Editor.make().config(ctx=>{
      ctx.set(rootCtx,host.current!);ctx.set(defaultValueCtx,value);configureCodeSchema(ctx);configureLiveMarkdown(ctx);
      ctx.update(editorViewOptionsCtx,previous=>({...previous,attributes:{...previous.attributes,class:'ProseMirror markdown-body visual-document',role:'textbox','aria-label':'可视化正文编辑器','aria-multiline':'true'},handleDOMEvents:{focus(){queueMicrotask(()=>selection());return false;},blur(){callbacks.current.onBlankLine?.(null);setBubble(null);return false;}},handlePaste(_view,event){const file=Array.from(event.clipboardData?.files||[]).find(f=>f.type.startsWith('image/'));if(file){event.preventDefault();actions.current.rememberSelection();callbacks.current.onPaste(file);return true;}const data=event.clipboardData;if(!data)return false;if(_view.state.selection.$from.parent.type.spec.code){event.preventDefault();_view.dispatch(_view.state.tr.insertText(data.getData('text/plain')));return true;}const markdown=clipboardMarkdown(data);if(markdown===null)return false;event.preventDefault();actions.current.insert(markdown);return true;},handleKeyDown(_view,event){if(liveShortcut(_view,event))return true;const current=menuRef.current;if(!current)return false;const list=slashItems.filter(x=>x.label.includes(current.query)||x.key.includes(current.query.toLowerCase()));if(event.key==='Escape'){slashDismissed.current=`${_view.state.selection.from}:/${current.query}`;setMenu(null);return true;}if(['ArrowDown','ArrowUp'].includes(event.key)){setMenu(m=>m?{...m,index:(m.index+(event.key==='ArrowDown'?1:list.length-1))%Math.max(1,list.length)}:m);return true;}if(event.key==='Enter'&&list.length){chooseRef.current(current.index%list.length);return true;}return false;}}));
    }).use(liveCommonmark).use(liveGfm).use(history).use(clipboard).use(visualSyntax).use(liveSyntax).use($prose(()=>liveMarkdownPlugin())).use($prose(()=>visualTabsPlugin())).use(visualNodeViews()).use(observer);
    instance.current=editor;
    editor.create().then(()=>{if(disposed){void editor.destroy();return;}mounted=true;setReady(true);selection();const queued=pendingInsert.current.splice(0);queued.forEach(text=>actions.current.insert(text));}).catch(e=>{if(!disposed)setError(`可视化加载失败，请使用源码模式：${e.message}`);});
    return()=>{disposed=true;mounted=false;instance.current=null;void editor.destroy();};
  // The document editor stays mounted while typing; external changes are applied below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{if(!ready||source.current===value)return;const editor=instance.current;if(!editor)return;try{suppress.current=true;editor.action(ctx=>{const v=ctx.get(editorViewCtx);const parsed=parseVisualMarkdown(ctx,value);if(!v.state.doc.eq(parsed)){const tr=v.state.tr.replaceWith(0,v.state.doc.content.size,parsed.content);tr.setMeta('addToHistory',false);v.dispatch(tr);}});source.current=value;setError('');}catch(e){setError(`源码暂无法载入可视化：${(e as Error).message}`);}finally{suppress.current=false;selection();}},[value,ready]);
  useEffect(()=>{if(!ready)return;let frame=0;const reposition=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>selection());};window.addEventListener('scroll',reposition,true);window.addEventListener('resize',reposition);return()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',reposition,true);window.removeEventListener('resize',reposition);};},[ready]);
  useEffect(()=>{const outside=(event:PointerEvent)=>{const current=menuRef.current;if(current&&!shell.current?.querySelector('.slash-menu')?.contains(event.target as Node)){slashDismissed.current=`${current.to}:/${current.query}`;setMenu(null);}};document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);},[]);
  return <div className="visual-editor-shell" ref={shell}>{error&&<p role="alert" className="form-error">{error}</p>}{!ready&&!error&&<p className="muted small editor-loading">加载编辑器…</p>}<div ref={host}/>{bubble&&createPortal(<div ref={bubbleRef} className={'selection-toolbar'+(bubbleDocked?' is-docked':'')} role="toolbar" aria-label="选区工具" style={{position:bubbleDocked?'relative':'fixed',visibility:'hidden'}} onMouseDown={event=>event.preventDefault()}>{([['strong','加粗',Bold],['emphasis','斜体',Italic],['inlineCode','行内代码',Code2],['inlineMath','行内公式',Sigma]] as const).map(([name,label,Icon])=><button key={name} type="button" aria-label={label} title={label} onClick={()=>actions.current.format(name)}><Icon size={16}/></button>)}<span className="toolbar-separator"/><button type="button" aria-label="快捷组合" title="将完整段落或列表项加入新内容组" disabled={!actions.current.canGroup()} onClick={()=>actions.current.groupSelection()}><Layers size={16}/></button><button type="button" aria-label="上移所选段落" title="上移完整段落或列表项" disabled={!actions.current.canMove(-1)} onClick={()=>actions.current.moveBlock(-1)}><ArrowUp size={16}/></button><button type="button" aria-label="下移所选段落" title="下移完整段落或列表项" disabled={!actions.current.canMove(1)} onClick={()=>actions.current.moveBlock(1)}><ArrowDown size={16}/></button><button type="button" aria-label="删除所选段落" title="删除完整段落或列表项（可撤销）" disabled={!actions.current.canDeleteSelection()} onClick={()=>actions.current.deleteSelectionBlocks()}><Trash2 size={16}/></button></div>,bubbleDocked&&document.querySelector('.editor-panel-dock')||document.fullscreenElement||document.body)}{menu&&<div role="menu" aria-label="插入区块" className="slash-menu" style={{top:menu.top,left:menu.left}} onMouseDown={e=>e.preventDefault()}>{items.length?items.map((item,index)=>{const Icon=insertionIcons[item.key as keyof typeof insertionIcons];return <button type="button" role="menuitem" key={item.key} className={index===menu.index%items.length?'active':''} onClick={()=>chooseRef.current(index)}><Icon size={15}/>{item.label}</button>;}):<span>没有匹配的区块</span>}</div>}</div>;
});

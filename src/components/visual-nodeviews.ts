'use client';
import { $view } from '@milkdown/kit/utils';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import { codeBlockSchema,imageSchema } from '@milkdown/kit/preset/commonmark';
import {imageNodeView} from './visual-image-view';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView as CodeView, lineNumbers } from '@codemirror/view';
import { minimalSetup } from 'codemirror';
import katex from 'katex';
import { containerNodes,containerNames,containerClass,mathNodes,rawBlockNode,htmlBlockNode } from '@/lib/visual-schema';
import {activateTab,tabChildren,tabTransaction,visualTabsKey} from '@/lib/visual-blocks';
import {htmlBlockMarkdown} from '@/lib/html-block';
import {undo,redo} from '@milkdown/kit/prose/history';
import type {NodeViewConstructor} from '@milkdown/kit/prose/view';
import { blockStyle } from '@/lib/styles';
import { parseCodeMeta } from '@/lib/code-block';
import { highlightLanguage,shikiHighlight } from './code-highlight';
import { mountLanguageSelect } from './code-language-select';

const labels:Record<string,string>={group:'内容组',details:'折叠',tabs:'标签页',tab:'标签',columns:'分栏',column:'列',gallery:'图库',figure:'图片说明'};
function select(view:any,getPos:()=>number|undefined){const p=getPos();if(p!==undefined)view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc,p)).setMeta('salmon-open-block',true));}
function setAttrs(view:any,getPos:()=>number|undefined,attrs:Record<string,any>){const p=getPos();if(p===undefined)return;const node=view.state.doc.nodeAt(p);if(node){const tr=view.state.tr.setNodeMarkup(p,undefined,{...node.attrs,...attrs});if(view.state.selection instanceof NodeSelection)tr.setSelection(NodeSelection.create(tr.doc,view.state.selection.from));view.dispatch(tr);}}
function exitBlock(view:any,getPos:()=>number|undefined){const p=getPos();if(p===undefined)return;const node=view.state.doc.nodeAt(p);if(!node)return;const end=p+node.nodeSize;const tr=view.state.tr.insert(end,view.state.schema.nodes.paragraph.create());tr.setSelection(TextSelection.near(tr.doc.resolve(end+1)));view.dispatch(tr);view.focus();}
function tabIcon(label:string,paths:string[]){
  const button=document.createElement('button');button.type='button';button.title=label;button.setAttribute('aria-label',label);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [key,value] of Object.entries({width:'14',height:'14',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);
  paths.forEach(d=>{const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path);});button.append(svg);return button;
}

export function sourceBlockView(html:boolean):NodeViewConstructor{return (initial,view,getPos)=>{
  let node=initial,generation=0,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
  const dom=document.createElement('div');dom.className=`visual-raw-block${html?' visual-html-block':''}`;dom.contentEditable='false';
  const bar=document.createElement('div');bar.className='visual-block-bar';
  const label=document.createElement('button');label.type='button';label.textContent=html?'自定义 HTML':'源码区块';label.setAttribute('aria-label',`选择${label.textContent}`);label.addEventListener('click',()=>select(view,getPos));
  const edit=document.createElement('button');edit.type='button';edit.textContent=html?'编辑 HTML':'编辑源码';edit.setAttribute('aria-expanded','false');
  const after=document.createElement('button');after.type='button';after.textContent='↵';after.setAttribute('aria-label','在区块后继续写作');after.addEventListener('click',()=>exitBlock(view,getPos));bar.append(label,edit,after);
  const input=document.createElement('textarea');input.setAttribute('aria-label',html?'HTML 源码':'区块源码');input.spellcheck=false;input.rows=6;input.hidden=true;
  const status=document.createElement('p');status.className='small muted html-preview-status';status.setAttribute('role','status');
  const retry=document.createElement('button');retry.type='button';retry.className='text-button';retry.textContent='重试预览';retry.hidden=true;
  const preview=document.createElement('div');preview.className='markdown-body html-block-preview';preview.setAttribute('aria-label',html?'HTML 效果预览':'区块效果预览');
  dom.append(bar,input,status,retry,preview);
  const draw=()=>{
    if(input.value!==node.attrs.value)input.value=node.attrs.value;
    clearTimeout(timer);controller?.abort();const current=++generation;
    status.hidden=false;status.textContent='正在生成预览…';retry.hidden=true;
    timer=setTimeout(async()=>{
      controller=new AbortController();
      try{
        const response=await fetch('/api/admin/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:html?htmlBlockMarkdown(node.attrs.value):node.attrs.value}),signal:controller.signal});
        if(!response.ok)throw new Error('preview');const result=await response.json();
        if(current!==generation)return;preview.innerHTML=result.html;status.hidden=true;
      }catch(error){if(current!==generation||(error as Error).name==='AbortError')return;status.textContent='预览暂不可用，源码已保留。';retry.hidden=false;}
    },300);
  };
  edit.addEventListener('click',()=>{select(view,getPos);input.hidden=!input.hidden;edit.setAttribute('aria-expanded',String(!input.hidden));edit.textContent=input.hidden?(html?'编辑 HTML':'编辑源码'):'收起源码';if(!input.hidden)input.focus();});
  input.addEventListener('focus',()=>select(view,getPos));input.addEventListener('input',()=>setAttrs(view,getPos,{value:input.value}));
  input.addEventListener('keydown',event=>{if(!(event.ctrlKey||event.metaKey))return;const key=event.key.toLowerCase();if(key==='z'||key==='y'){event.preventDefault();(key==='y'||event.shiftKey?redo:undo)(view.state,view.dispatch.bind(view));}});
  retry.addEventListener('click',draw);draw();
  return {dom,update(next){if(next.type!==node.type)return false;if(next.attrs.value!==node.attrs.value){node=next;draw();}return true;},stopEvent:()=>true,ignoreMutation:()=>true,destroy(){generation++;clearTimeout(timer);controller?.abort();},selectNode(){dom.classList.add('ProseMirror-selectednode');},deselectNode(){dom.classList.remove('ProseMirror-selectednode');}};
};}

export function visualNodeViews(){return [
  $view(imageSchema.node,()=>imageNodeView),
  ...containerNodes.map((schema,i)=>$view(schema,()=> (initial,view,getPos)=>{
    let node=initial;const name=containerNames[i];
    const dom=document.createElement('div');dom.dataset.salmonContainer=name;
    const header=document.createElement('div');header.className='visual-block-bar';header.contentEditable='false';
    const choose=document.createElement('button');choose.type='button';choose.textContent=labels[name];choose.title='选择区块';choose.addEventListener('click',()=>select(view,getPos));header.append(choose);
    let title:HTMLInputElement|undefined;
    if(name==='details'||name==='tab'){title=document.createElement('input');title.setAttribute('aria-label',name==='details'?'折叠标题':'标签标题');title.placeholder=name==='details'?'展开查看详细信息':'标签页';title.addEventListener('focus',()=>select(view,getPos));title.addEventListener('input',()=>setAttrs(view,getPos,{attributes:{...node.attrs.attributes,title:title!.value}}));header.append(title);}
    const after=document.createElement('button');after.type='button';after.textContent='↵';after.title='在区块后继续写作';after.setAttribute('aria-label','在区块后继续写作');after.addEventListener('click',()=>exitBlock(view,getPos));header.append(after);
    let nav:HTMLDivElement|undefined;let signature='';
    if(name==='tabs'){nav=document.createElement('div');nav.className='visual-tab-buttons';nav.contentEditable='false';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','编辑内容标签页');dom.append(header,nav);}
    const contentDOM=document.createElement('div');contentDOM.className='visual-block-content';dom.append(...(!nav?[header]:[]),contentDOM);
    const draw=()=>{
      const chosen=dom.classList.contains('ProseMirror-selectednode');dom.className=`visual-container ${containerClass(name,node.attrs.attributes)}${chosen?' ProseMirror-selectednode':''}`;dom.style.cssText=blockStyle(node.attrs.attributes);
      if(title&&document.activeElement!==title)title.value=node.attrs.attributes.title||'';dom.dataset.attributes=JSON.stringify(node.attrs.attributes);
      if(nav){
        const position=getPos();if(position===undefined)return;
        const tabs=tabChildren(node,position),state=visualTabsKey.getState(view.state)?.get(position);
        const titles=tabs.map((tab,index)=>tab.node.attrs.attributes.title||`标签 ${index+1}`);
        const nextSignature=JSON.stringify([titles,state?.id,state?.active]);
        if(signature!==nextSignature){
          signature=nextSignature;nav.replaceChildren();
          titles.forEach((text,index)=>{
            const segment=document.createElement('span');segment.className='visual-tab-segment'+(index===(state?.active||0)?' is-active':'');const button=document.createElement('button');button.type='button';button.textContent=text;button.setAttribute('role','tab');button.id=`${state?.id}-tab-${index}`;button.setAttribute('aria-controls',`${state?.id}-panel-${index}`);
            button.addEventListener('click',()=>{const p=getPos();if(p!==undefined)view.dispatch(activateTab(view.state,p,index));});
            button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length;const p=getPos();if(p!==undefined)view.dispatch(activateTab(view.state,p,next));(nav!.querySelectorAll<HTMLButtonElement>('[role=tab]')[next])?.focus();});segment.append(button);nav!.append(segment);
            if(index===(state?.active||0)){
              const controls=document.createElement('span');controls.className='visual-tab-actions';controls.setAttribute('role','group');controls.setAttribute('aria-label','当前标签操作');
              const specs=[['left','左移标签',['M19 12H5','m12 19-7-7 7-7']],['right','右移标签',['M5 12h14','m12 5 7 7-7 7']],['delete','删除标签',['M3 6h18','M9 6V4h6v2','M5 6l1 14h12l1-14','M10 10v6','M14 10v6']]] as const;
              for(const [action,label,paths] of specs){
                const control=tabIcon(label,[...paths]);control.disabled=action==='left'?index===0:action==='right'?index===tabs.length-1:tabs.length<=1;
                control.addEventListener('mousedown',event=>event.preventDefault());
                control.addEventListener('click',()=>{const p=getPos();if(p===undefined)return;const group=view.state.doc.nodeAt(p);if(!group)return;const tab=tabChildren(group,p)[index];if(!tab)return;const tr=tabTransaction(view.state,tab.position,action);if(tr){view.dispatch(tr);view.focus();}});
                controls.append(control);
              }segment.append(controls);
            }
          });
          const add=document.createElement('button');add.type='button';add.className='add-visual-tab';add.textContent='＋';add.setAttribute('aria-label','添加标签');add.title='添加标签';add.addEventListener('click',()=>{const p=getPos();if(p===undefined)return;const tr=tabTransaction(view.state,p,'add');if(tr){view.dispatch(tr);view.focus();}});nav.append(add);
        }
        nav.querySelectorAll<HTMLButtonElement>('[role=tab]').forEach((button,index)=>{button.setAttribute('aria-selected',String(index===(state?.active||0)));button.tabIndex=index===(state?.active||0)?0:-1;});
      }
    };draw();
    return {dom,contentDOM,update(next){if(next.type!==node.type)return false;node=next;draw();return true;},selectNode(){dom.classList.add('ProseMirror-selectednode');},deselectNode(){dom.classList.remove('ProseMirror-selectednode');},stopEvent:event=>header.contains(event.target as globalThis.Node)||!!nav?.contains(event.target as globalThis.Node),ignoreMutation:mutation=>mutation.type!=='selection'&&(mutation.target===dom||header.contains(mutation.target)||!!nav?.contains(mutation.target))};
  })),
  $view(codeBlockSchema.node,()=> (initial,view,getPos)=>{
    let node=initial;let syncing=false;const dom=document.createElement('div');dom.className='visual-code-block';dom.contentEditable='false';
    const bar=document.createElement('div');bar.className='visual-block-bar';const label=document.createElement('button');label.type='button';label.setAttribute('aria-label','选择代码块');label.addEventListener('click',()=>select(view,getPos));bar.append(label);
    const after=document.createElement('button');after.type='button';after.textContent='↵';after.setAttribute('aria-label','在代码块后继续写作');after.addEventListener('click',()=>exitBlock(view,getPos));bar.append(after);
    const language=document.createElement('select');bar.insertBefore(language,after);
    language.addEventListener('pointerdown',()=>select(view,getPos));
    language.addEventListener('focus',()=>select(view,getPos));
    const languageMenu=mountLanguageSelect(language,()=>node.attrs.language,language=>setAttrs(view,getPos,{language}));
    const host=document.createElement('div');dom.append(bar,host);const numbers=new Compartment();const syntax=new Compartment();
    const gutters=()=>{const o=parseCodeMeta(node.attrs.meta);return o.lineNumbers?lineNumbers({formatNumber:n=>String(o.start+n-1)}):[];};
    const inner=new CodeView({parent:host,state:EditorState.create({doc:node.textContent,extensions:[minimalSetup,numbers.of(gutters()),syntax.of(highlightLanguage.of(node.attrs.language)),shikiHighlight,CodeView.updateListener.of(update=>{
      if(syncing||!update.docChanged)return;const p=getPos();if(p===undefined)return;const text=update.state.doc.toString();const tr=view.state.tr;
      if(text)tr.replaceWith(p+1,p+1+node.content.size,view.state.schema.text(text));else tr.delete(p+1,p+1+node.content.size);
      view.dispatch(tr);
    }),CodeView.domEventHandlers({focus(){select(view,getPos);return false;},keydown(event){if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();exitBlock(view,getPos);return true;}return false;}})]})});
    const draw=()=>{label.textContent='代码';languageMenu.update();};draw();
    return {dom,update(next){if(next.type!==node.type)return false;const metaChanged=next.attrs.meta!==node.attrs.meta;const languageChanged=next.attrs.language!==node.attrs.language;node=next;syncing=true;try{if(inner.state.doc.toString()!==node.textContent)inner.dispatch({changes:{from:0,to:inner.state.doc.length,insert:node.textContent}});if(metaChanged)inner.dispatch({effects:numbers.reconfigure(gutters())});if(languageChanged)inner.dispatch({effects:syntax.reconfigure(highlightLanguage.of(node.attrs.language))});}finally{syncing=false;}draw();return true;},stopEvent:()=>true,ignoreMutation:()=>true,destroy(){languageMenu.destroy();inner.destroy();},selectNode(){dom.classList.add('ProseMirror-selectednode');},deselectNode(){dom.classList.remove('ProseMirror-selectednode');}};
  }),
  ...mathNodes.map((schema,i)=>$view(schema,()=> (initial,view,getPos)=>{
    let node=initial;const block=i===1;const dom=document.createElement(block?'div':'span');dom.className=`visual-math ${block?'visual-math-block':''}`;dom.contentEditable='false';
    const preview=document.createElement('button');preview.type='button';preview.className='visual-math-preview';preview.setAttribute('aria-label','编辑公式');
    dom.append(preview);preview.addEventListener('click',()=>select(view,getPos));
    const draw=()=>{preview.innerHTML=katex.renderToString(node.attrs.value||'\\square',{displayMode:block,throwOnError:false,trust:false,strict:false});};draw();
    return {dom,update(next){if(next.type!==node.type)return false;node=next;draw();return true;},stopEvent:()=>true,ignoreMutation:()=>true,selectNode(){dom.classList.add('ProseMirror-selectednode');},deselectNode(){dom.classList.remove('ProseMirror-selectednode');}};
  })),
  $view(htmlBlockNode,()=>sourceBlockView(true)),
  $view(rawBlockNode,()=>sourceBlockView(false)),
];}

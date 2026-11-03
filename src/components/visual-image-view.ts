import {undo,redo} from '@milkdown/kit/prose/history';
import {NodeSelection} from '@milkdown/kit/prose/state';
import type {NodeViewConstructor} from '@milkdown/kit/prose/view';
import {blockStyle} from '@/lib/styles';
import {workspaceMediaUrl} from '@/lib/workspace-media-url';

export const imageNodeView:NodeViewConstructor=(initial,view,getPos)=>{
  let node=initial,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined,generation=0;
  const dom=document.createElement('span');dom.className='visual-image';dom.contentEditable='false';dom.dataset.salmonImage='true';
  const image=document.createElement('img'),caption=document.createElement('span');caption.className='content-image-caption';const input=document.createElement('textarea');input.className='image-caption-editor auto-grow-textarea';input.rows=1;input.hidden=true;input.setAttribute('aria-label','图片说明');input.placeholder='添加图片说明…';let editing=false;dom.append(image,caption,input);
  const resize=()=>{input.style.height='0px';input.style.height=Math.max(32,input.scrollHeight)+'px';};
  const edit=(event:Event)=>{event.preventDefault();event.stopPropagation();editing=true;input.hidden=false;caption.hidden=true;input.value=node.attrs.caption||'';resize();input.focus();};
  caption.setAttribute('role','button');caption.tabIndex=0;caption.setAttribute('aria-label','编辑图片说明');caption.addEventListener('click',edit);caption.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){edit(event);}});
  input.addEventListener('click',event=>event.stopPropagation());
  input.addEventListener('input',event=>{const position=getPos();if(position===undefined)return;const from=input.selectionStart,to=input.selectionEnd;view.dispatch(view.state.tr.setNodeMarkup(position,undefined,{...node.attrs,caption:input.value}));resize();if(editing&&input.isConnected&&!(event as InputEvent).isComposing&&document.activeElement!==input){input.focus();input.setSelectionRange(from,to);}});
  input.addEventListener('blur',()=>{editing=false;input.hidden=true;draw();});
  const outside=(event:Event)=>{if(editing&&!dom.contains(event.target as Node)){editing=false;input.hidden=true;draw();}};
  document.addEventListener('pointerdown',outside,true);
  input.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();(event.key.toLowerCase()==='y'||event.shiftKey?redo:undo)(view.state,view.dispatch.bind(view));resize();}if(event.key==='Escape'){event.preventDefault();input.blur();view.focus();}});
  window.addEventListener('resize',resize);
  const select=(event:Event)=>{event.preventDefault();const position=getPos();if(position!==undefined)view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc,position)).setMeta('salmon-open-block',true));};
  dom.addEventListener('click',select);
  const standalone=()=>{if(view.isDestroyed)return;const position=getPos();if(position!==undefined&&position<=view.state.doc.content.size){const parent=view.state.doc.resolve(position).parent;dom.dataset.standalone=String(parent.isTextblock&&parent.childCount===1);}};
  image.addEventListener('load',standalone);queueMicrotask(standalone);
  function draw(){
    standalone();
    image.setAttribute('src',workspaceMediaUrl(node.attrs.src));image.alt=node.attrs.alt||'';image.title=node.attrs.title||'';
    dom.dataset.caption=node.attrs.caption||'';dom.dataset.figureAttributes=JSON.stringify(node.attrs.figureAttributes||{});
    dom.style.cssText=blockStyle(node.attrs.figureAttributes||{});
    caption.hidden=editing||!node.attrs.caption&&!dom.classList.contains('ProseMirror-selectednode');if(editing&&input.value!==node.attrs.caption){input.value=node.attrs.caption||'';resize();}clearTimeout(timer);controller?.abort();const current=++generation;
    if(!node.attrs.caption){caption.textContent='添加图片说明…';return;}if(editing)return;
    caption.textContent=node.attrs.caption;
    timer=setTimeout(async()=>{
      controller=new AbortController();
      try{
        const response=await fetch('/api/admin/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:node.attrs.caption}),signal:controller.signal});
        if(!response.ok)return;const data=await response.json();if(current===generation)caption.innerHTML=data.html;
      }catch{}
    },250);
  }draw();
  return {dom,update(next){if(next.type!==node.type)return false;const changed=next.attrs!==node.attrs;node=next;if(changed)draw();else standalone();return true;},stopEvent:()=>true,ignoreMutation:()=>true,selectNode(){dom.classList.add('ProseMirror-selectednode');standalone();if(!editing)caption.hidden=false;},deselectNode(){dom.classList.remove('ProseMirror-selectednode');if(!editing&&!node.attrs.caption)caption.hidden=true;},destroy(){document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',resize);generation++;clearTimeout(timer);controller?.abort();}};
};

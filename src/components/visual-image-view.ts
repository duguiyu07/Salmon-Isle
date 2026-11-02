import {NodeSelection} from '@milkdown/kit/prose/state';
import type {NodeViewConstructor} from '@milkdown/kit/prose/view';
import {blockStyle} from '@/lib/styles';
import {workspaceMediaUrl} from '@/lib/workspace-media-url';

export const imageNodeView:NodeViewConstructor=(initial,view,getPos)=>{
  let node=initial,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined,generation=0;
  const dom=document.createElement('span');dom.className='visual-image';dom.contentEditable='false';dom.dataset.salmonImage='true';
  const image=document.createElement('img'),caption=document.createElement('span');caption.className='content-image-caption';dom.append(image,caption);
  const select=(event:Event)=>{event.preventDefault();const position=getPos();if(position!==undefined)view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc,position)).setMeta('salmon-open-block',true));};
  dom.addEventListener('click',select);
  function draw(){
    image.setAttribute('src',workspaceMediaUrl(node.attrs.src));image.alt=node.attrs.alt||'';image.title=node.attrs.title||'';
    dom.dataset.caption=node.attrs.caption||'';dom.dataset.figureAttributes=JSON.stringify(node.attrs.figureAttributes||{});
    dom.style.cssText=blockStyle(node.attrs.figureAttributes||{});
    caption.hidden=!node.attrs.caption;clearTimeout(timer);controller?.abort();const current=++generation;
    if(!node.attrs.caption){caption.replaceChildren();return;}
    caption.textContent=node.attrs.caption;
    timer=setTimeout(async()=>{
      controller=new AbortController();
      try{
        const response=await fetch('/api/admin/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:node.attrs.caption}),signal:controller.signal});
        if(!response.ok)return;const data=await response.json();if(current===generation)caption.innerHTML=data.html;
      }catch{}
    },250);
  }draw();
  return {dom,update(next){if(next.type!==node.type)return false;const changed=next.attrs!==node.attrs;node=next;if(changed)draw();return true;},stopEvent:()=>true,ignoreMutation:()=>true,selectNode(){dom.classList.add('ProseMirror-selectednode');},deselectNode(){dom.classList.remove('ProseMirror-selectednode');},destroy(){generation++;clearTimeout(timer);controller?.abort();}};
};

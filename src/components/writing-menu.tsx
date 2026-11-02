'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Menu,X,ChevronLeft} from 'lucide-react';
import {useModalPanel} from './use-modal-panel';

export function WritingMenu({open,onOpenChange,status,statusKind,children,onExit,entity='文章'}:{open:boolean;onOpenChange:(open:boolean)=>void;status:string;statusKind:string;children:ReactNode;onExit?:()=>void;entity?:string}){
  const panel=useRef<HTMLElement>(null),drag=useRef<{x:number;y:number;left:number;top:number;moved:boolean}|null>(null),suppressClick=useRef(false);
  const launcher=useRef<HTMLButtonElement>(null),wasOpen=useRef(open);
  const [dock,setDock]=useState({side:'right',ratio:0}),[point,setPoint]=useState<{left:number;top:number}|null>(null),[height,setHeight]=useState(800);
  useEffect(()=>{
    try{const stored=JSON.parse(localStorage.getItem('salmon-writing-menu-position')||'null');if(stored&&['left','right'].includes(stored.side)&&Number.isFinite(stored.ratio))setDock({side:stored.side,ratio:Math.max(0,Math.min(1,stored.ratio))});}catch{}
    const resize=()=>setHeight(window.innerHeight);resize();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);
  },[]);
  useModalPanel(open,panel,()=>onOpenChange(false));
  useEffect(()=>{
    const closed=wasOpen.current&&!open;wasOpen.current=open;
    if(!closed)return;
    const frame=requestAnimationFrame(()=>launcher.current?.focus({preventScroll:true}));
    return()=>cancelAnimationFrame(frame);
  },[open]);
  const top=Math.max(16,Math.min(height-60,dock.ratio?dock.ratio*(height-44):24));
  return <>
    <button ref={launcher} type="button" className={`writing-menu-ball status-${statusKind}${point?' is-dragging':''}`} style={point?{left:point.left,top:point.top}:{[dock.side]:16,top}} aria-label={`打开${entity}菜单`} aria-description={status} aria-expanded={open} aria-controls="writing-menu-panel" title={`${entity}菜单 · ${status}`} hidden={open}
      onPointerDown={event=>{if(event.button!==0)return;const rect=event.currentTarget.getBoundingClientRect();drag.current={x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,moved:false};event.currentTarget.setPointerCapture(event.pointerId);}}
      onPointerMove={event=>{const current=drag.current;if(!current)return;const dx=event.clientX-current.x,dy=event.clientY-current.y;if(Math.hypot(dx,dy)>6)current.moved=true;if(current.moved)setPoint({left:Math.max(8,Math.min(window.innerWidth-52,current.left+dx)),top:Math.max(16,Math.min(window.innerHeight-60,current.top+dy))});}}
      onPointerUp={event=>{const current=drag.current;drag.current=null;if(!current)return;if(current.moved){const left=current.left+event.clientX-current.x,y=Math.max(16,Math.min(window.innerHeight-60,current.top+event.clientY-current.y));const next={side:left+22<window.innerWidth/2?'left':'right',ratio:y/(window.innerHeight-44)};setDock(next);try{localStorage.setItem('salmon-writing-menu-position',JSON.stringify(next));}catch{}suppressClick.current=true;}setPoint(null);}}
      onPointerCancel={()=>{drag.current=null;setPoint(null);}}
      onClick={()=>{if(suppressClick.current){suppressClick.current=false;return;}onOpenChange(true);}}><Menu size={19}/><span className="writing-menu-signal" aria-hidden="true"/></button>
    <button type="button" className="writing-menu-backdrop" hidden={!open} inert={!open} tabIndex={-1} aria-label={`关闭${entity}菜单`} onClick={()=>onOpenChange(false)}/>
    <aside ref={panel} id="writing-menu-panel" className="writing-menu-panel" role="dialog" aria-modal={open?true:undefined} aria-label={`${entity}菜单`} hidden={!open} inert={!open}>
      <div className="writing-menu-heading"><button type="button" className="text-button writing-back" onClick={onExit}><ChevronLeft size={15}/>退出编辑</button><button type="button" className="icon-button" aria-label={`关闭${entity}菜单`} onClick={()=>onOpenChange(false)}><X size={19}/></button></div>
      {children}
    </aside>
  </>;
}

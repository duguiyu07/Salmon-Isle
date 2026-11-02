'use client';
import {useEffect,useRef} from 'react';

export function useModalPanel(open:boolean,panel:React.RefObject<HTMLElement|null>,onClose:()=>void){
  const close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const root=panel.current;if(!open||!root)return;
    const overflow=document.body.style.overflow,previous=document.activeElement as HTMLElement|null;document.body.style.overflow='hidden';
    const controls=()=>Array.from(root.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,summary,[tabindex="0"]')).filter(element=>{
      const closed=element.closest('details:not([open])');
      return element.getClientRects().length>0&&!element.hasAttribute('disabled')&&!element.closest('[hidden],[inert]')&&(!closed||closed.querySelector(':scope > summary')?.contains(element));
    });
    controls()[0]?.focus({preventScroll:true});
    const keydown=(event:KeyboardEvent)=>{
      if(document.querySelector('dialog[open]'))return;
      if(event.key==='Escape'){event.preventDefault();close.current();return;}
      if(event.key!=='Tab')return;const list=controls();if(!list.length)return;
      const first=list[0],last=list.at(-1)!;if(event.shiftKey&&(document.activeElement===first||!root.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!root.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',keydown);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',keydown);if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[open,panel]);
}

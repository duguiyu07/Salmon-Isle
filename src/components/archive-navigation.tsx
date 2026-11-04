'use client';
import {useLayoutEffect,useRef,useTransition} from 'react';
import {useRouter} from 'next/navigation';

export function ArchiveNavigation({root,html}:{root:React.RefObject<HTMLDivElement|null>;html:string}){
  const router=useRouter(),[pending,startTransition]=useTransition(),snapshot=useRef<{scroll:number;closed:Set<string>}[]>([]),navigating=useRef(false);
  useLayoutEffect(()=>{
    const host=root.current;if(!host)return;const archives=Array.from(host.querySelectorAll<HTMLElement>('[data-archive-root]'));
    archives.forEach((archive,index)=>{const saved=snapshot.current[index],tree=archive.querySelector<HTMLElement>('.knowledge-tree');if(!saved||!tree)return;archive.querySelectorAll<HTMLDetailsElement>('details[data-folder-id]').forEach(branch=>branch.open=!saved.closed.has(branch.dataset.folderId!));tree.scrollTop=saved.scroll;
      if(navigating.current)archive.querySelector<HTMLElement>('.tree-row.active a,.tree-root.active')?.focus({preventScroll:true});
    });navigating.current=false;
    const save=()=>{snapshot.current=archives.map(archive=>({scroll:archive.querySelector<HTMLElement>('.knowledge-tree')?.scrollTop||0,closed:new Set(Array.from(archive.querySelectorAll<HTMLDetailsElement>('details[data-folder-id]')).filter(branch=>!branch.open).map(branch=>branch.dataset.folderId!))}));};
    const click=(event:MouseEvent)=>{if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;const target=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[data-archive-nav]'):null;
      if(!target||!host.contains(target)||target.target||target.hasAttribute('download'))return;
      const url=new URL(target.href,window.location.href);if(url.origin!==window.location.origin)return;
      event.preventDefault();save();navigating.current=true;startTransition(()=>router.push(url.pathname+url.search+url.hash,{scroll:false}));
    };
    host.addEventListener('click',click);host.addEventListener('toggle',save,true);host.addEventListener('scroll',save,true);
    return()=>{host.removeEventListener('click',click);host.removeEventListener('toggle',save,true);host.removeEventListener('scroll',save,true);};
  },[html,root,router]);
  useLayoutEffect(()=>{root.current?.querySelectorAll('[data-archive-root]').forEach(archive=>archive.setAttribute('aria-busy',String(pending)));},[pending,html,root]);
  return null;
}

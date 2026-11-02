'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ChevronRight,FolderClosed,FolderOpen,Files,LockKeyhole } from 'lucide-react';
export interface TreeFolder {id:string;name:string;parentId:string;locked?:boolean}
export function PublicFolderNav({folders,current}:{folders:TreeFolder[];current:string}){
  return <nav className="knowledge-tree" aria-label="文章分类"><FolderTree folders={folders} current={current}/></nav>;
}
export function FolderTree({folders,current='root',onSelect}:{folders:TreeFolder[];current?:string;onSelect?:(id:string)=>void}){
  const [closed,setClosed]=useState<Set<string>>(new Set());
  function row(id:string,depth:number):React.ReactNode{return folders.filter(f=>f.parentId===id&&f.id!=='root').map(f=>{
    const children=folders.some(c=>c.parentId===f.id);const open=!closed.has(f.id);const content=<><span className="tree-folder-icon">{current===f.id?<FolderOpen size={17}/>:<FolderClosed size={17}/>}</span><span className="tree-label">{f.name}</span>{f.locked&&<LockKeyhole size={12}/>}</>;
    return <div key={f.id}><div className={`tree-row ${current===f.id?'active':''}`} style={{paddingLeft:depth*14+6}}><button className={`tree-chevron ${children?'':'invisible'}`} aria-label={`${open?'收起':'展开'} ${f.name}`} onClick={()=>setClosed(s=>{const n=new Set(s);if(n.has(f.id))n.delete(f.id);else n.add(f.id);return n;})}><ChevronRight size={13} style={{transform:open?'rotate(90deg)':''}}/></button>{onSelect?<button className="tree-select" onClick={()=>onSelect(f.id)}>{content}</button>:<Link className="tree-select" href={`/knowledge?folder=${encodeURIComponent(f.id)}`}>{content}</Link>}</div>{children&&open&&row(f.id,depth+1)}</div>;
  });}
  const rootContent=<><Files size={17}/><span>所有文章</span></>;
  return <div className="folder-tree">{onSelect?<button className={`tree-root ${current==='root'?'active':''}`} onClick={()=>onSelect('root')}>{rootContent}</button>:<Link className={`tree-root ${current==='root'?'active':''}`} href="/knowledge">{rootContent}</Link>}{row('root',0)}</div>;
}

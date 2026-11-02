'use client';
import {useEffect,useRef,useState,type ComponentProps} from 'react';
import {X} from 'lucide-react';
import type { Folder } from '@/lib/model';
import type { WritingDocument } from './writing-editor';
import {useModalPanel} from './use-modal-panel';

const accessNames={inherit:'继承上级',public:'公开',password:'密码保护',private:'私密'};
export function ArticleSettings({doc,folders,onChange}:{doc:WritingDocument;folders:Folder[];onChange:(patch:Partial<WritingDocument>)=>void}){
  return <div className="article-settings"><div className="article-settings-grid">
    {doc.kind!=='page'&&<label>所属文件夹<select value={doc.folderId} onChange={e=>onChange({folderId:e.target.value})}>{folders.map(f=><option value={f.id} key={f.id}>{f.path||'根目录'}</option>)}</select></label>}
    {doc.kind==='page'&&<><label>集合文件夹<select value={doc.collection?.folderId||''} onChange={e=>onChange({collection:{folderId:e.target.value,perPage:doc.collection?.perPage||10}})}><option value="">选择文件夹</option>{folders.map(f=><option key={f.id} value={f.id}>{f.path||'根目录'}</option>)}</select></label><label>集合每页篇数<input type="number" min="1" max="50" value={doc.collection?.perPage||10} onChange={e=>onChange({collection:{folderId:doc.collection?.folderId||'',perPage:Math.min(50,Math.max(1,Number(e.target.value)||10))}})}/></label></>}
    <label>访问权限<select value={doc.access||'inherit'} onChange={e=>onChange({access:e.target.value as WritingDocument['access']})}>{Object.entries(accessNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    {doc.access==='password'&&<label>{doc.hasPassword?'更换密码（留空保持）':'设置访问密码'}<input type="password" autoComplete="new-password" value={doc.password||''} onChange={e=>onChange({password:e.target.value})}/></label>}
    <label>排序权重<input type="number" value={doc.order||0} onChange={e=>onChange({order:Number(e.target.value)})}/></label>
    <label className="inline-check"><input type="checkbox" checked={doc.pinned||false} onChange={e=>onChange({pinned:e.target.checked})}/>首页置顶</label>
    <p className="small muted settings-full">上级目录的私密与密码限制始终有效。</p>
    <label className="settings-full">封面地址<input value={doc.cover||''} onChange={e=>onChange({cover:e.target.value})}/></label>
    <details className="settings-full article-settings-more"><summary>更多设置</summary><div className="article-settings-grid">
      <label>旧地址别名（每行一个）<textarea rows={2} value={(doc.aliases||[]).join('\n')} onChange={e=>onChange({aliases:e.target.value.split('\n').filter(Boolean)})}/></label>
      <label>评论关联值<input value={doc.giscusTerm||''} onChange={e=>onChange({giscusTerm:e.target.value})} placeholder="默认使用永久 ID"/></label>
    </div></details>
  </div></div>;
}

export function ArticleSettingsPanel({open,onClose,...props}:ComponentProps<typeof ArticleSettings>&{open:boolean;onClose:()=>void}){
  const panel=useRef<HTMLElement>(null),close=useRef(onClose);close.current=onClose;
  const [mobile,setMobile]=useState(false);
  useEffect(()=>{const query=window.matchMedia('(max-width:1100px)'),update=()=>setMobile(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
  useModalPanel(open&&mobile,panel,onClose);
  useEffect(()=>{
    if(!open||mobile)return;
    const previous=document.activeElement as HTMLElement|null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    const keydown=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('dialog[open]')){event.preventDefault();close.current();}};
    document.addEventListener('keydown',keydown);
    return()=>{document.removeEventListener('keydown',keydown);if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[open,mobile]);
  return <>{open&&mobile&&<button type="button" className="writing-settings-backdrop" aria-label="返回文章编辑" onClick={onClose}/>}
    <aside id="writing-article-settings" ref={panel} className="writing-article-settings" hidden={!open} role={mobile?'dialog':'complementary'} aria-modal={open&&mobile?true:undefined} aria-label="文章设置">
      <div className="writing-settings-heading"><h2>文章设置</h2><button type="button" className="icon-button" aria-label="关闭文章设置" onClick={onClose}><X size={18}/></button></div>
      {open&&<ArticleSettings {...props}/>}
    </aside>
  </>;
}

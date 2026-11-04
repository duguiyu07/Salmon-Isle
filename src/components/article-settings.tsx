'use client';
import {ImagePlus} from 'lucide-react';
import type { Folder } from '@/lib/model';
import type { WritingDocument } from './writing-editor';
import {FolderOptions} from './folder-options';

const accessNames={inherit:'继承上级',public:'公开',password:'密码保护',private:'私密'};
export function ArticleSettings({doc,folders,onChange,onChooseCover}:{doc:WritingDocument;folders:Folder[];onChange:(patch:Partial<WritingDocument>)=>void;onChooseCover?:()=>void}){
  return <div className="article-settings"><div className="article-settings-grid">
    <section className="settings-full article-presentation-group" aria-label="展示设置">
      <label>文章摘要<textarea rows={3} value={doc.summary||''} onChange={event=>onChange({summary:event.target.value})}/></label>
      <button className="button secondary cover-picker-button" type="button" onClick={onChooseCover}><ImagePlus size={16}/>设置封面图片</button>
      {doc.cover&&<div className="article-cover-selection"><img src={doc.cover} alt="当前封面"/><button className="text-button" type="button" onClick={()=>onChange({cover:''})}>移除封面</button></div>}
      <label className="inline-check"><input type="checkbox" checked={doc.pinned||false} onChange={event=>onChange({pinned:event.target.checked})}/>首页置顶</label>
    </section>
    <label>所属文件夹<select value={doc.folderId} onChange={e=>onChange({folderId:e.target.value})}><FolderOptions folders={folders}/></select></label>
    <label>访问权限<select value={doc.access||'inherit'} onChange={e=>onChange({access:e.target.value as WritingDocument['access']})}>{Object.entries(accessNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    {doc.access==='password'&&<label>{doc.hasPassword?'更换密码（留空保持）':'设置访问密码'}<input type="password" autoComplete="new-password" value={doc.password||''} onChange={e=>onChange({password:e.target.value})}/></label>}
    <p className="small muted settings-full">上级目录的私密与密码限制始终有效。</p>
    <details className="settings-full article-settings-more"><summary>高级设置</summary><div className="article-settings-grid">
      <label>排序权重<input type="number" value={doc.order||0} onChange={event=>onChange({order:Number(event.target.value)})}/></label>
      <label>旧地址别名（每行一个）<textarea rows={2} value={(doc.aliases||[]).join('\n')} onChange={e=>onChange({aliases:e.target.value.split('\n').filter(Boolean)})}/></label>
      <label>评论关联值<input value={doc.giscusTerm||''} onChange={e=>onChange({giscusTerm:e.target.value})} placeholder="默认使用永久 ID"/></label>
    </div></details>
  </div></div>;
}

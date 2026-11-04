'use client';
import {useEffect,useRef,useState} from 'react';
import type {ClientArticleSummary,EditorDraftSummary} from '@/lib/editor-draft-model';
import type {Folder,Access} from '@/lib/model';
import type {ArticleBatch} from '@/lib/article-batch';
import {FolderOptions} from './folder-options';

const labels={move:'移动到文件夹',access:'设置权限',publish:'发布／更新',unpublish:'撤回为草稿'};
export function BatchActions({articles,drafts,folders,onDone}:{articles:ClientArticleSummary[];drafts:EditorDraftSummary[];folders:Omit<Folder,'passwordHash'>[];onDone:()=>Promise<unknown>}){
  const [action,setAction]=useState<ArticleBatch['action']|null>(null),[folderId,setFolderId]=useState('root'),[access,setAccess]=useState<Access>('inherit'),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(action)dialog.current?.showModal();else dialog.current?.close();},[action]);
  async function submit(){
    if(!action)return;setBusy(true);setError('');
    try{
      const response=await fetch('/api/admin/articles/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,articles:articles.map(article=>({id:article.id,baseVersion:article.version,draftVersion:drafts.find(draft=>draft.articleId===article.id)?.draftVersion||null})),folderId,access,...(action==='access'&&access==='password'?{password}:{})})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'批量操作失败');
      setPassword('');setAction(null);await onDone();
    }catch(error){setError((error as Error).message);}finally{setBusy(false);}
  }
  return <><div className="admin-batch-actions">{(Object.keys(labels) as ArticleBatch['action'][]).map(value=><button className="text-button" type="button" key={value} onClick={()=>{setError('');setPassword('');setAction(value);}}>{labels[value]}</button>)}</div>
    <dialog className="batch-dialog" ref={dialog} onCancel={event=>{event.preventDefault();if(!busy){setAction(null);setPassword('');}}}>
      <form onSubmit={event=>{event.preventDefault();void submit();}}><h2>{action&&labels[action]}</h2><p>将处理选中的 {articles.length} 篇文章。</p>
        {action==='move'&&<label>目标文件夹<select value={folderId} onChange={event=>setFolderId(event.target.value)}><FolderOptions folders={folders}/></select></label>}
        {action==='access'&&<><label>访问权限<select value={access} onChange={event=>setAccess(event.target.value as Access)}><option value="inherit">继承上级</option><option value="public">公开</option><option value="private">私密</option><option value="password">密码保护</option></select></label>{access==='password'&&<label>统一的新密码<input type="password" autoComplete="new-password" value={password} maxLength={1024} required onChange={event=>setPassword(event.target.value)}/></label>}</>}
        {action==='publish'&&<p className="muted">包含最新保存的编辑稿；已发布且没有编辑稿的文章将跳过。</p>}
        {action==='unpublish'&&<p className="muted">撤下所选文章，并保留已有编辑稿。</p>}
        {error&&<p className="form-error" role="alert">{error}</p>}
        <div className="admin-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>{setAction(null);setPassword('');}}>取消</button><button className="button primary" disabled={busy}>{busy?'正在处理…':'确认'+(action?labels[action]:'')}</button></div>
      </form>
    </dialog></>;
}

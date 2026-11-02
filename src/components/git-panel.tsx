'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {GitCommitHorizontal,RefreshCw,UploadCloud,GitBranch,Check,AlertCircle,Settings2,FileDiff,History} from 'lucide-react';
import {contentApi} from '@/lib/content-api';
import {RepositoryConnection} from './repository-connection';
import type {GitStatus,GitCommit,GitChange,GitDiff,GitConflict} from '@/lib/git-model';
const phaseNames={unconfigured:'尚未连接内容仓库',saved:'本地已保存',pending:'有待提交修改','push-pending':'已提交待推送','sync-pending':'已推送待同步',synced:'网站已同步',conflict:'存在合并冲突',error:'操作失败'};
export function RepositoryIndicator({onOpen}:{onOpen:()=>void}){
  const [status,setStatus]=useState<GitStatus|null>(null);
  useEffect(()=>{let active=true;const refresh=()=>{void contentApi<GitStatus>('admin/git/status').then(value=>{if(active)setStatus(value);}).catch(()=>{});};refresh();const timer=setInterval(refresh,15000);return()=>{active=false;clearInterval(timer);};},[]);
  return <button className="text-button" onClick={onOpen} title="查看内容同步状态"><GitCommitHorizontal size={14}/>{status?.behind?'有 '+status.behind+' 个远程提交待合并':phaseNames[status?.phase||'saved']}</button>;
}
export function GitPanel({desktop,onChanged}:{desktop:boolean;onChanged:()=>Promise<unknown>}){
  const [mode,setMode]=useState<'pending'|'history'>('pending'),[showConnection,setShowConnection]=useState(false);
  const [status,setStatus]=useState<GitStatus|null>(null),[history,setHistory]=useState<GitCommit[]>([]),[selectedRevision,setSelectedRevision]=useState<string|undefined>();
  const [files,setFiles]=useState<GitChange[]>([]),[diff,setDiff]=useState<GitDiff|null>(null),[selectedFile,setSelectedFile]=useState(''),[conflictList,setConflictList]=useState<GitConflict[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const operation=useRef<string|null>(null),diffRequest=useRef(0),revisionRequest=useRef(0);
  const refresh=useCallback(async()=>{
    const next=await contentApi<GitStatus>('admin/git/status');setStatus(next);
    if(next.configured){setConflictList(next.conflicts.length?await contentApi('admin/git/conflicts'):[]);if(mode==='pending')setFiles(next.changes);setHistory(await contentApi('admin/git/history'));}
    return next;
  },[mode]);
  useEffect(()=>{void refresh().catch(error=>setError(error.message));const timer=setInterval(()=>{if(!busy)void refresh().catch(()=>{});},5000);return()=>clearInterval(timer);},[refresh,busy]);
  useEffect(()=>{diffRequest.current++;revisionRequest.current++;setDiff(null);setSelectedFile('');setSelectedRevision(undefined);setFiles(mode==='pending'?status?.changes||[]:[]);},[mode]);
  async function act(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();await refresh();await onChanged();}catch(error){setError((error as Error).message);await refresh().catch(()=>{});}finally{setBusy(false);}}
  async function selectFile(file:GitChange,revision=selectedRevision){
    const request=++diffRequest.current;setSelectedFile(file.path);setDiff(null);
    try{const query=new URLSearchParams({path:file.path,...(revision?{revision}:{}),...(file.oldPath?{oldPath:file.oldPath}:{})});const result=await contentApi<GitDiff>('admin/git/diff?'+query);if(request===diffRequest.current)setDiff(result);}
    catch(error){if(request===diffRequest.current)setError((error as Error).message);}
  }
  async function selectRevision(revision:string){
    const request=++revisionRequest.current;diffRequest.current++;setSelectedRevision(revision);setSelectedFile('');setDiff(null);setFiles([]);
    try{const next=await contentApi<GitChange[]>('admin/git/changes?'+new URLSearchParams({revision}));if(request===revisionRequest.current)setFiles(next);}catch(error){if(request===revisionRequest.current)setError((error as Error).message);}
  }
  return <section className="git-panel" aria-busy={!status}>
    <div className="admin-page-heading"><h1>提交</h1><div className="admin-actions">
      <button className="button secondary" disabled={busy} onClick={()=>setShowConnection(value=>!value)}><Settings2 size={15}/>仓库连接</button>
      <button className="button secondary" disabled={busy||!status?.configured} onClick={()=>void act(()=>contentApi('admin/git/sync',{}))}><RefreshCw size={15}/>拉取并合并</button>
    </div></div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {!status&&<div className="git-status" role="status">正在读取仓库状态…</div>}
    {status&&<div className={'git-status phase-'+status.phase} role="status">
      {status.phase==='synced'?<Check size={17}/>:status.phase==='error'||status.phase==='conflict'?<AlertCircle size={17}/>:<GitCommitHorizontal size={17}/>}<strong>{phaseNames[status.phase]}</strong>
      {status.branch&&<span><GitBranch size={13}/>{status.branch}</span>}{status.head&&<span>本地 <code>{status.head.slice(0,8)}</code></span>}{status.liveRevision&&<span>线上 <code>{status.liveRevision.slice(0,8)}</code></span>}
      {status.behind>0&&<span>有 {status.behind} 个远程提交待合并</span>}{status.error&&<p>{status.error}</p>}
      {desktop&&status.siteUrl&&<a href={new URL('/admin',status.siteUrl).href} target="_blank" rel="noreferrer">打开在线后台与网站设置 ↗</a>}
    </div>}
    {status&&(!status.configured||showConnection)&&<RepositoryConnection desktop={desktop} status={status} onConnected={async()=>{await refresh();await onChanged();setShowConnection(false);}}/>}
    {status?.configured&&!showConnection&&<>
      {conflictList.map(conflict=><ConflictEditor key={conflict.path} conflict={conflict} busy={busy} resolve={(choice,content)=>void act(()=>contentApi('admin/git/resolve',{path:conflict.path,choice,content}))}/>)}
      <div className="git-section-tabs" role="tablist" aria-label="提交视图">
        <button type="button" role="tab" aria-selected={mode==='pending'} onClick={()=>setMode('pending')}><FileDiff size={15}/>工作区 <span>{status.changes.length}</span></button>
        <button type="button" role="tab" aria-selected={mode==='history'} onClick={()=>setMode('history')}><History size={15}/>历史记录</button>
      </div>
      <div className={'git-browser'+(mode==='history'?' history-mode':'')}>
        {mode==='history'&&<nav className="git-history" aria-label="提交历史">{history.map(commit=><button key={commit.sha} className={selectedRevision===commit.sha?'active':''} onClick={()=>void selectRevision(commit.sha)}><strong>{commit.message}</strong><span>{commit.author} · {new Date(commit.time).toLocaleString('zh-CN')}</span><code>{commit.sha.slice(0,12)}</code></button>)}{!history.length&&<p className="small muted">暂无提交记录</p>}</nav>}
        <div className="git-worktree"><div className="git-files" aria-label="变更文件">
          <div className="git-files-heading">{mode==='pending'?'已保存改动':'提交中的改动'}<span>{files.length}</span></div>
          {files.map(file=><button key={file.path} className={selectedFile===file.path?'active':''} onClick={()=>void selectFile(file)}><span className="git-file-status">{file.status}</span><span>{file.oldPath&&<small>{file.oldPath} → </small>}{file.path}</span></button>)}
          {!files.length&&<p className="small muted">{mode==='history'?'选择提交查看文件':'工作区没有未提交改动'}</p>}
        </div>
        {mode==='pending'&&<form className="git-submit" onSubmit={event=>{event.preventDefault();void act(async()=>{operation.current??=crypto.randomUUID();await contentApi('admin/git/commit',{message,operationId:operation.current});operation.current=null;setMessage('');});}}>
          <label>提交信息<input value={message} onChange={event=>setMessage(event.target.value)} maxLength={2000} placeholder="自动填写提交信息"/></label>
          <button type="submit" className="button primary" disabled={busy||!!status.conflicts.length||(!files.length&&!status.ahead)}><UploadCloud size={16}/>{busy?'正在处理…':status.ahead?'继续推送已有提交':'提交并推送'}</button>
          <p className="small muted">{status.ahead?'重试推送会沿用已有提交，新编辑留待下一次提交。':'整批提交所有已保存改动；网站完成同步后生效。'}</p>
        </form>}</div>
        <div className="git-diff" aria-label="文件差异">{diff?<><h2>{diff.path}</h2>{diff.binary?<BinaryDiff diff={diff}/>:diff.patch?<pre className="diff-patch">{diff.patch.split('\n').map((line,index)=><span key={index} className={line.startsWith('+')?'added':line.startsWith('-')?'removed':line.startsWith('@@')?'hunk':''}>{line||' '}<br/></span>)}</pre>:<div className="diff-columns"><section><h3>修改前</h3><pre>{diff.before||'（不存在）'}</pre></section><section><h3>修改后</h3><pre>{diff.after||'（已删除）'}</pre></section></div>}</>:<div className="empty-state"><FileDiff size={28}/><h3>{selectedFile?'正在读取差异…':'选择文件查看 diff'}</h3><p>{mode==='pending'?'核对改动后再提交并推送。':'选择历史提交，再选择需要查看的文件。'}</p></div>}</div>
      </div>
    </>}
  </section>;
}

function BinaryDiff({diff}:{diff:GitDiff}){
  const source=(revision:string|null,after=false)=>revision?'/api/admin/git/blob?'+new URLSearchParams({revision,path:after?diff.path:diff.beforePath}):after&&diff.path.startsWith('media/')?'/api/media/'+diff.path.slice(6)+'?workspace=1':null;
  return <div className="diff-columns"><BinaryPreview title="修改前" exists={diff.beforeExists} url={source(diff.beforeRevision)}/><BinaryPreview title="修改后" exists={diff.afterExists} url={source(diff.afterRevision,true)}/></div>;
}
function BinaryPreview({title,url,exists}:{title:string;url:string|null;exists:boolean}){const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[url]);return <section><h3>{title}</h3>{!exists?<p className="muted">此版本中不存在该资源。</p>:url&&!failed?<img className="binary-preview" src={url} alt={title} onError={()=>setFailed(true)}/>:<p className="muted">二进制资源；可在媒体库查看文件详情。</p>}</section>;}
function ConflictEditor({conflict,busy,resolve}:{conflict:GitConflict;busy:boolean;resolve:(choice:'local'|'remote'|'manual',content?:string)=>void}){
  const [content,setContent]=useState(conflict.local);return <section className="git-conflict"><h2>合并冲突 · {conflict.path}</h2><p className="small muted">选择保留的版本，或编辑合并结果。其他文件会继续保留。</p>{!conflict.binary&&<><div className="conflict-columns">{[['共同基线',conflict.base],['本地修改',conflict.local],['远程更新',conflict.remote]].map(([title,value])=><section key={title}><h3>{title}</h3><pre>{value||'（不存在）'}</pre></section>)}</div><label>手动合并结果<textarea rows={10} value={content} onChange={event=>setContent(event.target.value)}/></label></>}<div className="admin-actions"><button className="button secondary" disabled={busy} onClick={()=>resolve('local')}>采用本地修改{!conflict.hasLocal?'（删除）':''}</button><button className="button secondary" disabled={busy} onClick={()=>resolve('remote')}>采用远程更新{!conflict.hasRemote?'（删除）':''}</button>{!conflict.binary&&<button className="button primary" disabled={busy} onClick={()=>resolve('manual',content)}>保存手动合并</button>}</div></section>;
}

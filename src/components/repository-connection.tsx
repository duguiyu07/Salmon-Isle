'use client';
import {useEffect,useRef,useState} from 'react';
import {Github,FolderOpen,Check,ArrowRight,RefreshCw} from 'lucide-react';
import {contentApi} from '@/lib/content-api';
import type {GitStatus,GitChange} from '@/lib/git-model';
interface SetupJob {id:string;phase:'preparing'|'review'|'applying'|'done'|'error';step:string;error?:string;sha?:string;backup?:string;changes?:GitChange[];summary?:{articles:number;folders:number;media:number;drafts:number};config:{remote:string;branch:string;workspace:string;siteUrl:string}}
export function RepositoryConnection({desktop,status,onConnected}:{desktop:boolean;status:GitStatus|null;onConnected:()=>Promise<unknown>}){
  const [connection,setConnection]=useState({remote:status?.remote||'',workspace:status?.workspace||'',branch:status?.branch||'',siteUrl:status?.siteUrl||''});
  const [github,setGithub]=useState<{authorized:boolean;repository:string|null}>({authorized:false,repository:null}),[job,setJob]=useState<SetupJob|null>(null);
  const [busy,setBusy]=useState(false),[manual,setManual]=useState(false),[recreate,setRecreate]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const completed=useRef('');
  useEffect(()=>{
    if(desktop){if(!connection.workspace)void window.salmonDesktop?.defaultDirectory().then(workspace=>setConnection(previous=>({...previous,workspace})));return;}
    const params=new URLSearchParams(window.location.search);
    if(params.get('github')==='connected'){setConnection(previous=>({...previous,remote:params.get('remote')||previous.remote,branch:params.get('branch')||previous.branch}));setNotice('GitHub 已授权，接下来预检并迁移网站内容。');}
    if(params.get('github')==='cancelled')setError('GitHub 登录已取消，可以重新连接。');
    if(params.get('github')==='error')setError(params.get('reason')||'GitHub 授权未完成，请重试。');
    let active=true;
    const refresh=()=>{void contentApi<{job:SetupJob|null;github:typeof github}>('admin/git/setup').then(result=>{
      if(!active)return;setJob(result.job);setGithub(result.github);
      if(result.github.repository)setConnection(previous=>({...previous,remote:previous.remote||'https://github.com/'+result.github.repository+'.git'}));
      if(result.job?.phase==='done'&&completed.current!==result.job.id){completed.current=result.job.id;void onConnected();}
    }).catch(error=>{if(active)setError(error.message);});};
    refresh();const timer=setInterval(refresh,1800);return()=>{active=false;clearInterval(timer);};
  },[desktop]);
  const working=busy||job?.phase==='preparing'||job?.phase==='applying';
  const isGithub=/^https:\/\/github\.com\//i.test(connection.remote),authorized=github.authorized&&connection.remote.replace(/^https:\/\/github\.com\//i,'').replace(/\.git\/?$/,'').replace(/\/$/,'').toLowerCase()===github.repository?.toLowerCase();
  async function action(callback:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await callback();}catch(error){setError((error as Error).message);}finally{setBusy(false);}}
  async function authorize(){
    const result=await contentApi<{action:string;manifest:unknown;redirect?:string}>('admin/git/github/start',{remote:connection.remote,recreate});
    if(result.redirect){window.location.assign(result.redirect);return;}
    const form=document.createElement('form');form.method='POST';form.action=result.action;
    const input=document.createElement('input');input.type='hidden';input.name='manifest';input.value=JSON.stringify(result.manifest);form.append(input);document.body.append(form);form.submit();
  }
  async function preflight(){const next=await contentApi<SetupJob>('admin/git/setup/preflight',{...connection,siteUrl:window.location.origin,workspace:connection.workspace||undefined,branch:connection.branch||undefined,manual:manual||!isGithub});setJob(next);}
  return <section className="repository-connection">
    <div className="connection-intro"><Github size={24}/><div><h2>{status?.configured?'仓库连接':'连接内容仓库'}</h2><p>{desktop?'填写仓库与网站地址，登录 GitHub 后自动下载内容。':'连接私有仓库，让网站和桌面端通过 Git 同步内容。'}</p></div></div>
    <ol className="connection-steps">{(desktop?['连接仓库','GitHub 登录','下载内容']:['仓库与授权','迁移预检','确认并同步']).map((label,index)=><li key={label} className={desktop?busy?'current':'':index===(job?.phase==='done'?3:job?.phase==='applying'?2:job?.phase==='review'?1:0)?'current':''}><span>{job?.phase==='done'?<Check size={12}/>:index+1}</span>{label}</li>)}</ol>
    {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="admin-notice">{notice}</p>}
    <form className="repo-connect-form" onSubmit={event=>{event.preventDefault();void action(async()=>{
      if(desktop){await contentApi('admin/git/connect',connection);setNotice('仓库已连接，可以离线编辑。');await onConnected();}
      else if(isGithub&&!manual&&!authorized)await authorize();else await preflight();
    });}}>
      <label>内容仓库地址<input type="text" required placeholder="https://github.com/you/content.git" value={connection.remote} disabled={working} onChange={event=>setConnection({...connection,remote:event.target.value})}/></label>
      {desktop&&<label>网站地址<input type="url" required placeholder="https://your-site.example" value={connection.siteUrl} disabled={working} onChange={event=>setConnection({...connection,siteUrl:event.target.value})}/></label>}
      <details className="connection-advanced"><summary>高级设置</summary><div>
        <label>同步分支<input placeholder="自动使用仓库默认分支" value={connection.branch} disabled={working} onChange={event=>setConnection({...connection,branch:event.target.value})}/></label>
        <label>{desktop?'本地目录':'服务器内容目录'}<div className="repo-path-input"><input placeholder={desktop?'自动选择本地目录':'自动选择持久化数据目录'} value={connection.workspace} disabled={working} onChange={event=>setConnection({...connection,workspace:event.target.value})}/>{desktop&&<button type="button" className="button secondary" disabled={working} onClick={async()=>{const workspace=await window.salmonDesktop?.chooseDirectory();if(workspace)setConnection({...connection,workspace});}}><FolderOpen size={16}/>选择</button>}</div></label>
        {!desktop&&<label className="connection-check"><input type="checkbox" checked={manual} disabled={working} onChange={event=>setManual(event.target.checked)}/>使用已有 SSH 或服务器 Git 凭据</label>}
        {!desktop&&!manual&&<label className="connection-check"><input type="checkbox" checked={recreate} disabled={working} onChange={event=>setRecreate(event.target.checked)}/>重新创建授权应用（仅原应用已删除时使用）</label>}
      </div></details>
      {!desktop&&authorized&&!manual&&<p className="small muted"><Check size={13}/> GitHub 已授权 {github.repository} <button type="button" className="text-button" disabled={working} onClick={()=>void action(authorize)}>重新授权</button></p>}
      <div className="admin-actions"><button type="submit" className="button primary" disabled={working}>{busy?'正在连接…':desktop?'连接并下载':isGithub&&!manual&&!authorized?'前往 GitHub 授权':'预检网站内容'}<ArrowRight size={15}/></button></div>
      {desktop&&<p className="small muted">首次登录将在系统浏览器中进行，凭据保存在 Windows 中。登录取消或网络中断后可以重试。</p>}
    </form>
    {!desktop&&job&&<section className="setup-progress" aria-live="polite">
      <h3>{job.step}{working&&<RefreshCw size={14} className="spin"/>}</h3>{job.error&&<p className="form-error">{job.error}</p>}
      {job.summary&&<p>{job.summary.articles} 篇文章和页面 · {job.summary.folders} 个文件夹 · {job.summary.media} 个媒体 · {job.summary.drafts} 份编辑稿</p>}
      {job.changes&&<><p className="small muted">以网站现有内容为准；以下改动将在保留远程历史的基础上生成提交。</p><ul className="setup-changes">{job.changes.map(file=><li key={file.path}><code>{file.status}</code><span>{file.path}</span></li>)}</ul></>}
      {job.backup&&<p className="small muted">完整备份：{job.backup}</p>}
      {(job.phase==='review'||job.phase==='error'&&job.changes)&&<div className="admin-actions"><button className="button primary" disabled={working} onClick={()=>void action(async()=>{setJob(await contentApi('admin/git/setup/apply',{id:job.id}));})}>{job.phase==='error'?'重试迁移':'备份并确认接入'}</button><button className="button secondary" disabled={working} onClick={()=>void action(preflight)}>重新预检</button></div>}
      {job.phase==='done'&&<p className="small muted">网站已同步 · {job.sha?.slice(0,12)}</p>}
    </section>}
  </section>;
}

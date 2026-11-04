'use client';
import {useEffect,useState} from 'react';
import {RefreshCw,ArrowUpRight} from 'lucide-react';
import {contentApi} from '@/lib/content-api';
type ServerStatus={version:string;manifestUrl:string;available:boolean;latest:{version:string;notesUrl:string;dockerImage?:string}|null};
export function ProgramUpdates(){
  const [server,setServer]=useState<ServerStatus|null>(null),[source,setSource]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{void contentApi<ServerStatus>('admin/program-updates').then(value=>{setServer(value);setSource(value.manifestUrl);}).catch(error=>setError(error.message));},[]);
  async function check(){setBusy(true);setError('');try{await contentApi('admin/program-updates',{manifestUrl:source});setServer(await contentApi('admin/program-updates?check=1'));}catch(error){setError((error as Error).message);}finally{setBusy(false);}}
  return <section className="program-updates"><div className="admin-page-heading"><h1>程序更新</h1></div>
    <div className="update-summary"><RefreshCw size={23}/><div><h2>{server?.available?'发现网站新版本':'网站版本'}</h2><p>当前版本 {server?.version}{server?.available?' · 新版本 '+server.latest?.version:''}</p></div></div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="admin-actions"><button className="button secondary" disabled={busy} onClick={()=>void check()}><RefreshCw size={15}/>{busy?'正在检查…':'检查更新'}</button>{server?.latest&&<a href={server.latest.notesUrl} target="_blank" rel="noreferrer" className="button secondary">版本说明<ArrowUpRight size={15}/></a>}</div>
    <p className="small muted">在服务器运行更新脚本即可更新程序；脚本会先备份数据，保留数据卷，并在启动检查失败时回退镜像。</p>
    <div className="website-update-commands"><h3>更新网站</h3><p>Linux / Docker</p><pre>{'sh scripts/update-site.sh'+(server?.latest?.dockerImage?' --image '+server.latest.dockerImage:'')}</pre><p>Windows / Docker</p><pre>{'powershell -ExecutionPolicy Bypass -File scripts/update-site.ps1'+(server?.latest?.dockerImage?' -Image '+server.latest.dockerImage:'')}</pre></div>
    <details className="connection-advanced"><summary>更新源</summary><label>网站版本信息地址<input type="url" value={source} disabled={busy} onChange={event=>setSource(event.target.value)} placeholder="https://github.com/owner/source/releases/latest/download/release.json"/></label></details>
  </section>;
}

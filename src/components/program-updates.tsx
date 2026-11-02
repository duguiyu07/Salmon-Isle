'use client';
import {useEffect,useState} from 'react';
import {RefreshCw,Download,ArrowUpRight} from 'lucide-react';
import {contentApi} from '@/lib/content-api';
import type {DesktopUpdateStatus} from '@/lib/desktop-bridge';
type ServerStatus={version:string;manifestUrl:string;desktopFeed:string;available:boolean;checkedAt:string|null;latest:{version:string;notesUrl:string;dockerImage?:string;desktopFeed?:string}|null};
const names={unconfigured:'尚未配置更新源',idle:'可以检查新版本',checking:'正在检查更新…',available:'发现新版本',current:'当前已是最新版本',downloading:'正在下载更新…',ready:'更新已下载，可以安装',error:'更新未完成'};
export function ProgramUpdates({desktop}:{desktop:boolean}){
  const [native,setNative]=useState<DesktopUpdateStatus|null>(null),[server,setServer]=useState<ServerStatus|null>(null),[source,setSource]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    if(desktop){let active=true;const refresh=()=>{void window.salmonDesktop?.updateStatus().then(value=>{if(active){setNative(value);setSource(previous=>previous||value.feedUrl);}});};refresh();const timer=setInterval(refresh,1200);
      void contentApi<{siteUrl?:string}>('admin/git/status').then(async status=>{if(!status.siteUrl)return;const response=await fetch(new URL('/api/program-info',status.siteUrl));if(response.ok){const info=await response.json();if(active&&typeof info.desktopFeed==='string')setSource(previous=>previous||info.desktopFeed);}}).catch(()=>{});
      return()=>{active=false;clearInterval(timer);};
    }
    void contentApi<ServerStatus>('admin/program-updates').then(value=>{setServer(value);setSource(value.manifestUrl);}).catch(error=>setError(error.message));
  },[desktop]);
  async function act(callback:()=>Promise<void>){setBusy(true);setError('');try{await callback();}catch(error){setError((error as Error).message);}finally{setBusy(false);}}
  const working=busy||native?.phase==='checking'||native?.phase==='downloading';
  return <section className="program-updates"><div className="admin-page-heading"><h1>程序更新</h1></div>
    <div className="update-summary"><RefreshCw size={23}/><div><h2>{desktop?names[native?.phase||'idle']:server?.available?'发现网站新版本':'网站版本'}</h2><p>当前版本 {desktop?native?.currentVersion:server?.version}{desktop&&native?.version?' · 新版本 '+native.version:server?.available?' · 新版本 '+server.latest?.version:''}</p></div></div>
    {(error||native?.error)&&<p className="form-error" role="alert">{error||native?.error}</p>}
    {desktop&&native?.phase==='downloading'&&<div className="update-progress"><progress max={100} value={native.progress}/><span>{native.progress.toFixed(0)}%</span></div>}
    <div className="admin-actions"><button className="button secondary" disabled={working||native?.phase==='ready'} onClick={()=>void act(async()=>{if(desktop){const result=await window.salmonDesktop!.checkUpdate(source||undefined);setNative(result);}else {await contentApi('admin/program-updates',{manifestUrl:source});setServer(await contentApi('admin/program-updates?check=1'));}})}><RefreshCw size={15}/>检查更新</button>
      {desktop&&native?.phase==='available'&&<button className="button primary" disabled={working} onClick={()=>void act(async()=>setNative(await window.salmonDesktop!.downloadUpdate()))}><Download size={15}/>下载更新</button>}
      {desktop&&native?.phase==='ready'&&<button className="button primary" disabled={working} onClick={()=>void act(async()=>{await window.salmonDesktop!.installUpdate();})}>保存并重启安装</button>}
      {!desktop&&server?.latest&&<a href={server.latest.notesUrl} target="_blank" rel="noreferrer" className="button secondary">版本说明<ArrowUpRight size={15}/></a>}
    </div>
    <p className="small muted">{desktop?'覆盖升级保留连接配置、凭据和本地内容。安装前会保存所有编辑窗口，无需先卸载。':'在服务器运行更新脚本即可更新程序；脚本会先备份数据，保留数据卷，并在启动检查失败时回退镜像。'}</p>
    {!desktop&&<div className="website-update-commands"><h3>更新网站</h3><p>Linux / Docker</p><pre>{'sh scripts/update-site.sh'+(server?.latest?.dockerImage?' --image '+server.latest.dockerImage:'')}</pre><p>Windows / Docker</p><pre>{'powershell -ExecutionPolicy Bypass -File scripts/update-site.ps1'+(server?.latest?.dockerImage?' -Image '+server.latest.dockerImage:'')}</pre>{server?.latest?.dockerImage&&<p className="small muted">最新镜像：<code>{server.latest.dockerImage}</code></p>}</div>}
    <details className="connection-advanced"><summary>更新源</summary><div><label>{desktop?'桌面程序更新目录':'网站版本信息地址'}<input type="url" value={source} disabled={working} onChange={event=>setSource(event.target.value)} placeholder={desktop?'https://github.com/owner/source/releases/latest/download/':'https://github.com/owner/source/releases/latest/download/release.json'}/></label><p className="small muted">使用软件源码项目的发布地址，内容仓库不用于发布程序安装包。</p></div></details>
  </section>;
}

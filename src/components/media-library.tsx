'use client';
import {useEffect,useRef,useState} from 'react';
import {Upload,ImagePlus,File,Trash2,X,ArrowUpRight,ChevronLeft,ChevronRight} from 'lucide-react';
import {contentApi} from '@/lib/content-api';
import {mediaAccept,type Media,type MediaReference,type MediaPage,type MediaUsage} from '@/lib/media-model';

export function MediaLibrary({onSelect,imagesOnly=false,onChanged}:{onSelect?:(media:Media)=>void;imagesOnly?:boolean;onChanged?:()=>void}){
  const [data,setData]=useState<MediaPage>({items:[],page:1,pageSize:24,pages:1,total:0,totalAll:0});
  const [query,setQuery]=useState(''),[type,setType]=useState(imagesOnly?'image':'all'),[usage,setUsage]=useState<MediaUsage>('all'),[page,setPage]=useState(1),[refreshKey,setRefreshKey]=useState(0);
  const [selected,setSelected]=useState<Media|null>(null),[references,setReferences]=useState<MediaReference[]>([]),[referencesLoading,setReferencesLoading]=useState(false);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[referencesError,setReferencesError]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);
    const timer=setTimeout(()=>{const params=new URLSearchParams({q:query,type,usage,page:String(page)});
      void fetch('/api/admin/media?'+params,{signal:controller.signal,cache:'no-store'}).then(async response=>{
        const result=await response.json();if(!response.ok)throw new Error(result.error);
        if(controller.signal.aborted)return;
        setData(result);setPage(result.page);setSelected(previous=>previous&&result.items.some((item:Media)=>item.id===previous.id)?previous:null);setError('');
      }).catch(error=>{if(!controller.signal.aborted)setError(error.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    },180);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query,type,usage,page,refreshKey]);
  useEffect(()=>{
    const controller=new AbortController();setReferences([]);setReferencesLoading(!!selected);setReferencesError(false);
    if(selected)void fetch('/api/admin/media/'+selected.id+'/references',{signal:controller.signal,cache:'no-store'}).then(async response=>{
      const result=await response.json();if(!response.ok)throw new Error(result.error);if(!controller.signal.aborted)setReferences(result);
    }).catch(error=>{if(!controller.signal.aborted){setError(error.message);setReferencesError(true);}}).finally(()=>{if(!controller.signal.aborted)setReferencesLoading(false);});
    return()=>controller.abort();
  },[selected,refreshKey]);
  const refresh=()=>setRefreshKey(value=>value+1);
  async function upload(files:FileList|null){
    if(!files)return;setBusy(true);setError('');
    try{for(const file of Array.from(files)){const form=new FormData();form.set('file',file);const response=await fetch('/api/admin/media',{method:'POST',body:form});const result=await response.json();if(!response.ok)throw new Error(result.error);}refresh();onChanged?.();}
    catch(error){setError((error as Error).message);}finally{setBusy(false);}
  }
  const activeReferences=references.some(ref=>ref.kind!=='trash'),trashOnly=references.length>0&&!activeReferences;
  async function remove(){
    if(!selected)return;
    const message=trashOnly?'此资源仅被回收站内容引用。强制删除会将这些位置替换为“资源已删除”占位，恢复文章后也会保留占位。继续？':'将「'+selected.name+'」移入回收站？确认后将从网站移除。';
    if(!window.confirm(message))return;
    setBusy(true);setError('');
    try{await contentApi('admin/media/'+selected.id,{forceTrashReferences:trashOnly},'DELETE');setSelected(null);refresh();onChanged?.();}
    catch(error){setError((error as Error).message);refresh();}finally{setBusy(false);}
  }
  const numbers=Array.from({length:data.pages},(_,index)=>index+1).filter(number=>number===1||number===data.pages||Math.abs(number-data.page)<=2);
  return <section className="media-library" aria-label="媒体库">
    <div className="media-heading">
      <div className="media-title"><h1>{onSelect?'选择图片':'媒体库'}</h1><span className="small muted">{data.totalAll} 个资源{(query||type!=='all'&&!imagesOnly||usage!=='all')?' · 找到 '+data.total+' 个':''}</span></div>
      <div className="media-toolbar">
        <input aria-label="搜索媒体" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}} placeholder="搜索文件名…"/>
        {!imagesOnly&&<select aria-label="媒体类型" value={type} onChange={event=>{setType(event.target.value);setPage(1);}}><option value="all">全部类型</option><option value="image">图片</option><option value="audio">音频</option><option value="video">视频</option><option value="other">其他附件</option></select>}
        <select aria-label="引用状态" value={usage} onChange={event=>{setUsage(event.target.value as MediaUsage);setPage(1);}}><option value="all">全部引用状态</option><option value="unused">无引用</option><option value="trash">仅回收站引用</option><option value="active">存在有效引用</option></select>
        <label className={'button secondary media-upload'+(busy?' is-disabled':'')} aria-disabled={busy}><Upload size={15}/>{busy?'正在上传…':'上传资源'}<input type="file" hidden multiple disabled={busy} accept={imagesOnly?'image/png,image/jpeg,image/webp,image/gif,image/avif,.svg':mediaAccept} onChange={event=>{void upload(event.target.files);event.target.value='';}}/></label>
      </div>
    </div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="media-layout">
      <div className="media-results" aria-busy={loading}>
        <div className="media-grid">{data.items.map(media=><button type="button" key={media.id} className={'media-tile'+(selected?.id===media.id?' selected':'')} onClick={()=>setSelected(media)} onDoubleClick={()=>onSelect?.(media)} aria-pressed={selected?.id===media.id}>
          {media.type.startsWith('image/')?<img loading="lazy" src={'/api/media/'+media.id+'?workspace=1'} alt={media.name}/>:<span className="media-file-icon"><File size={32}/>{media.type.split('/')[0]}</span>}
          <strong title={media.name}>{media.name}</strong><small>{(media.size/1024).toFixed(1)} KB</small>
        </button>)}</div>
        {!data.items.length&&<div className="empty-state"><ImagePlus size={30}/><h3>{loading?'正在读取媒体…':'暂无匹配的媒体资源'}</h3></div>}
        <nav className="media-pagination" aria-label="媒体分页">
          <span className="small muted">{data.total?'第 '+((data.page-1)*data.pageSize+1)+'–'+Math.min(data.page*data.pageSize,data.total)+' 项，共 '+data.total+' 项':'共 0 项'}</span>
          <div><button type="button" className="icon-button" disabled={loading||data.page===1} onClick={()=>setPage(data.page-1)} aria-label="上一页"><ChevronLeft size={16}/></button>
            {numbers.map((number,index)=><span key={number}>{index>0&&number>numbers[index-1]+1&&<span className="page-gap">…</span>}<button type="button" className="media-page-number" disabled={loading} aria-current={number===data.page?'page':undefined} onClick={()=>setPage(number)}>{number}</button></span>)}
            <button type="button" className="icon-button" disabled={loading||data.page===data.pages} onClick={()=>setPage(data.page+1)} aria-label="下一页"><ChevronRight size={16}/></button>
          </div>
        </nav>
      </div>
      {selected&&<aside className="media-details">
        <div className="media-detail-heading"><h2>{selected.name}</h2><button className="icon-button" type="button" aria-label="关闭资源详情" onClick={()=>setSelected(null)}><X size={16}/></button></div>
        <p className="small muted">{selected.type} · {(selected.size/1024).toFixed(1)} KB</p>
        <h3>引用位置</h3>
        {referencesLoading?<p className="small muted">正在检查引用…</p>:referencesError?<button className="text-button" onClick={refresh}>引用检查失败，点击重试</button>:references.length?<div className="media-reference-list">{references.map(ref=><a className="media-reference-card" key={ref.href} href={ref.href} target="_blank" rel="noopener noreferrer"><strong>{ref.title}<ArrowUpRight size={13}/></strong><span>{ref.kind==='trash'?'回收站 · ':ref.kind==='draft'?'编辑稿 · ':''}{ref.field.replace(/^编辑稿 · /,'')}</span><small>{ref.location}</small></a>)}</div>:<p className="small muted">暂无引用</p>}
        <div className="admin-actions">{onSelect?<button className="button primary" type="button" onClick={()=>onSelect(selected)}><ImagePlus size={15}/>插入图片</button>:<>
          <a className="button secondary" href={'/api/media/'+selected.id+'?workspace=1'} target="_blank" rel="noreferrer"><ArrowUpRight size={15}/>查看</a>
          <button className="button secondary" type="button" disabled={busy||referencesLoading||referencesError||activeReferences} title={activeReferences?'存在文章或编辑稿引用，请先解除引用':''} onClick={()=>void remove()}><Trash2 size={15}/>{trashOnly?'强制删除':'删除'}</button>
        </>}</div>
        {activeReferences&&<p className="small muted">仍有有效引用，暂时无法删除。</p>}
      </aside>}
    </div>
  </section>;
}

export function ImagePicker({onClose,onSelect,onUpload,title='插入图片'}:{title?:string;onClose:()=>void;onSelect:(value:{url:string;name:string;type:string})=>void;onUpload:(file:File)=>Promise<void>}){
  const dialog=useRef<HTMLDialogElement>(null),[tab,setTab]=useState('library'),[url,setUrl]=useState(''),[alt,setAlt]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  return <dialog className="image-picker" ref={dialog} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <div className="modal-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label="关闭图片选择" onClick={onClose} disabled={busy}><X size={19}/></button></div>
    <div className="image-source-tabs" role="tablist" aria-label="图片来源">{[['library','媒体库'],['upload','上传'],['url','URL']].map(([id,label])=><button key={id} id={'image-tab-'+id} type="button" role="tab" aria-controls={'image-panel-'+id} aria-selected={tab===id} disabled={busy} onClick={()=>{setTab(id);setError('');}}>{label}</button>)}</div>
    {error&&<p role="alert" className="form-error">{error}</p>}
    <div className="image-picker-body">
      <div id="image-panel-library" role="tabpanel" aria-labelledby="image-tab-library" hidden={tab!=='library'}><MediaLibrary imagesOnly onSelect={media=>onSelect({url:'/api/media/'+media.id,name:media.name,type:media.type})}/></div>
      <div id="image-panel-upload" role="tabpanel" aria-labelledby="image-tab-upload" hidden={tab!=='upload'}><div className="image-upload-zone"><Upload size={28}/><h3>上传图片</h3><p>图片上传到网站，发布文章后可供访客访问。单个文件不超过 40 MB。</p><label className={'button primary'+(busy?' is-disabled':'')}>{busy?'正在上传…':'选择图片'}<input hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,.svg" disabled={busy} onChange={async event=>{const file=event.target.files?.[0];if(!file)return;setBusy(true);setError('');try{await onUpload(file);onClose();}catch(error){setError((error as Error).message);}finally{setBusy(false);}}}/></label></div></div>
      <div id="image-panel-url" role="tabpanel" aria-labelledby="image-tab-url" hidden={tab!=='url'}><form className="image-url-form" onSubmit={event=>{event.preventDefault();try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))throw new Error('仅支持 HTTP 或 HTTPS 图片地址');onSelect({url:parsed.href,name:alt,type:'image/url'});}catch(error){setError((error as Error).message);}}}><label>图片地址<input type="url" required placeholder="https://example.com/image.png" value={url} onChange={event=>setUrl(event.target.value)}/></label><label>替代文本<input value={alt} onChange={event=>setAlt(event.target.value)}/></label><p className="small muted">外链图片使用原地址，显示取决于图片来源。</p><button className="button primary" type="submit">{title}</button></form></div>
    </div>
  </dialog>;
}

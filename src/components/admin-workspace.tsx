'use client';
import {staticAsset} from '@/lib/static-asset';
import Link from 'next/link';
import { useEffect,useRef,useState,useMemo } from 'react';
import { useRouter,useSearchParams } from 'next/navigation';
import {adminHref,parseAdminView,lastModified} from '@/lib/admin-view';
import {browserRecoveries,saveBrowserRecovery,clearBrowserRecovery,removeBrowserRecovery,type BrowserRecovery} from '@/lib/browser-recovery';
import {BatchActions} from './batch-actions';
import {contentApi as api} from '@/lib/content-api';
import { Plus,FolderPlus,FileText,FolderClosed,Upload,Trash2,Download,LogOut,ArrowUpRight,ChevronLeft,Save,LockKeyhole,Globe,Shield,RotateCcw,Pencil,X,Check,LoaderCircle,ArrowRight,PanelRight,Maximize2,Minimize2 } from 'lucide-react';
import type { Article,Folder,SiteSettings } from '@/lib/model';
import { FolderTree } from './folder-tree';
import { dateText } from './article-card';
import type {WritingHandle,EditorMode} from './writing-editor';
import dynamic from 'next/dynamic';
import {FolderOptions} from './folder-options';
import {OpenArticle} from './open-article';
import {ArticleSettings} from './article-settings';
import {PageSettings} from './page-settings';
import {WritingMenu} from './writing-menu';
import type {PageEditorHandle,PageEditorMode} from './page-editor';
import type {PageDocument} from '@/lib/editor-draft-model';
import {DraftSaveSession,type SaveStatus} from '@/lib/draft-save-session';
import type {EditorDraftSummary,ClientEditorDraft,ClientArticleSummary} from '@/lib/editor-draft-model';
const loading=()=> <p role="status" className="muted">正在加载…</p>;
const WritingEditor=dynamic(()=>import('./writing-editor').then(module=>module.LazyWritingEditor),{ssr:false,loading});
const PageEditor=dynamic(()=>import('./page-editor').then(module=>module.LazyPageEditor),{ssr:false,loading});
const MediaLibrary=dynamic(()=>import('./media-library').then(module=>module.MediaLibrary),{loading});
const ImagePicker=dynamic(()=>import('./media-library').then(module=>module.ImagePicker),{loading});
const ProgramUpdates=dynamic(()=>import('./program-updates').then(module=>module.ProgramUpdates),{loading});
const ImportPanel=dynamic(()=>import('./import-panel').then(module=>module.ImportPanel),{loading});
type ClientArticle=Omit<Article,'passwordHash'>&{hasPassword:boolean};
type ClientFolder=Omit<Folder,'passwordHash'>&{hasPassword:boolean};
type Trash={id:string;kind:string;title:string;originalPath:string;time:string};
type State={articles:ClientArticleSummary[];pages?:ClientArticleSummary[];editorDrafts?:EditorDraftSummary[];folders:ClientFolder[];settings:SiteSettings;trash:Trash[]};
type Document=Partial<ClientArticle>&{title:string;body:string;folderId:string;password?:string;draftVersion?:string};
const accessNames={inherit:'继承上级',public:'公开',password:'密码保护',private:'私密'};
const newDocument=(folderId='root'):Document=>({id:crypto.randomUUID(),title:'',body:'',folderId,kind:'post',status:'draft',access:'inherit',summary:'',order:0,pinned:false});
function updateContent(state:State,article:ClientArticle):State{return {...state,articles:[...state.articles.filter(a=>a.id!==article.id),...(article.kind==='post'?[article]:[])],pages:[...(state.pages||[]).filter(a=>a.id!==article.id),...(article.kind==='page'?[article]:[])]};}

export function AdminWorkspace({initial}:{initial:State}){
  const [state,setState]=useState(initial);
  const [imagePicker,setImagePicker]=useState<'body'|'cover'|null>(null);
  const searchParams=useSearchParams(),view=parseAdminView(searchParams),viewKey=searchParams.toString();
  const [section,setSection]=useState(view.section);
  const [folder,setFolder]=useState(view.folder);
  const [query,setQuery]=useState(view.q);
  const [status,setStatus]=useState(view.status);
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const recoverySession=useRef(''),restoredKey=useRef(''),documentRequest=useRef(0),creationRoute=useRef('');
  const draftsById=useMemo(()=>new Map((state.editorDrafts||[]).map(draft=>[draft.articleId,draft])),[state.editorDrafts]);
  const [doc,setDoc]=useState<Document|null>(null);
  const [dirty,setDirty]=useState(false);
  const [menuOpen,setMenuOpen]=useState(false),[editorSession,setEditorSession]=useState(0),[mode,setMode]=useState<EditorMode>('visual'),[blockAvailable,setBlockAvailable]=useState(false);
  const [saveStatus,setSaveStatus]=useState<SaveStatus>({phase:'idle'}),[fullscreen,setFullscreen]=useState(false),[fullscreenAvailable,setFullscreenAvailable]=useState(false);
  const shell=useRef<HTMLDivElement>(null),editing=useRef<{document:Document;session:DraftSaveSession}|null>(null);
  const [settingsDraft,setSettingsDraft]=useState(initial.settings);
  const settingsDirty=JSON.stringify(settingsDraft)!==JSON.stringify(state.settings);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<{text:string;error?:boolean}|null>(null);
  const [preview,setPreview]=useState('');
  const [pageMode,setPageMode]=useState<PageEditorMode>('html');
  const [previewCss,setPreviewCss]=useState(''),[previewClass,setPreviewClass]=useState(''),[previewError,setPreviewError]=useState('');
  const [recoveries,setRecoveries]=useState<BrowserRecovery[]>([]);
  const [folderEdit,setFolderEdit]=useState<Partial<ClientFolder>&{password?:string}>({});
  const folderDialog=useRef<HTMLDialogElement>(null);
  const leaveDialog=useRef<HTMLDialogElement>(null);
  const pendingLeave=useRef<(()=>void)|null>(null);
  const writing=useRef<WritingHandle>(null);
  const pageWriting=useRef<PageEditorHandle>(null);
  const router=useRouter();
  const toast=(text:string,error=false)=>setNotice({text,error});
  const clearRecovery=()=>{const id=editing.current?.document.id;if(id)clearBrowserRecovery(recoverySession.current,id);if(restoredKey.current){removeBrowserRecovery(restoredKey.current);restoredKey.current='';}setRecoveries(browserRecoveries());};
  const publishedArticle=doc?[...state.articles,...(state.pages||[])].find(article=>article.id===doc.id):undefined;
  const listHref=adminHref({section:doc?.kind==='page'?'pages':section,folder,q:query,status});
  function navigateLink(event:{preventDefault:()=>void},href:string){event.preventDefault();requestLeave(()=>router.push(href,{scroll:false}));}
  function filter(next:{folder?:string;q?:string;status?:string}){
    setSelected(new Set());if(next.folder!==undefined)setFolder(next.folder);if(next.q!==undefined)setQuery(next.q);if(next.status!==undefined)setStatus(next.status);
    const href=adminHref({section,folder,q:query,status,...next});
    if(next.q!==undefined)window.history.replaceState(null,'',href);else router.push(href,{scroll:false});
  }
  useEffect(()=>{recoverySession.current=crypto.randomUUID();setRecoveries(browserRecoveries());const persist=()=>{const current=editing.current;if(current?.session.dirty())saveBrowserRecovery(recoverySession.current,current.document);};window.addEventListener('pagehide',persist);return()=>{persist();window.removeEventListener('pagehide',persist);};},[]);
  useEffect(()=>{setFullscreenAvailable(!!document.fullscreenEnabled);const change=()=>setFullscreen(!!document.fullscreenElement);document.addEventListener('fullscreenchange',change);return()=>document.removeEventListener('fullscreenchange',change);},[]);
  useEffect(()=>{const current=editing.current;if(!doc||!current)return;const timer=current.session.startAutosave();return()=>clearInterval(timer);},[editorSession,!!doc]);
  useEffect(()=>{if(!dirty||!doc)return;const timer=setTimeout(()=>{const current=editing.current;if(current&&!current.session.blocked)void current.session.save().catch(()=>{});},800);return()=>clearTimeout(timer);},[doc,dirty]);
  async function refresh(){const data=await api('admin/state');setState(data);return data as State;}
  async function run(action:()=>Promise<void>){setBusy(true);try{await action();}catch(e){toast((e as Error).message,true);}finally{setBusy(false);}}
  function requestLeave(action:()=>void){
    if(!dirty&&!settingsDirty){action();return;}
    pendingLeave.current=action;leaveDialog.current?.showModal();
  }
  function cancelLeave(){pendingLeave.current=null;leaveDialog.current?.close();}
  function discardAndLeave(){const action=pendingLeave.current;pendingLeave.current=null;leaveDialog.current?.close();action?.();}
  useEffect(()=>{
    const callback=(event:BeforeUnloadEvent)=>{if(dirty||settingsDirty){const current=editing.current;if(current?.session.dirty())saveBrowserRecovery(recoverySession.current,current.document);event.preventDefault();}};
    window.addEventListener('beforeunload',callback);
    return()=>window.removeEventListener('beforeunload',callback);
  },[dirty,settingsDirty]);
  useEffect(()=>{
    if(!dirty||!doc)return;
    const timer=setTimeout(()=>saveBrowserRecovery(recoverySession.current,doc),250);
    return()=>clearTimeout(timer);
  },[doc,dirty]);
  useEffect(()=>{
    if(!doc||(doc.kind==='page'?pageMode!=='preview':mode!=='preview'))return;
    const controller=new AbortController();
    const timer=setTimeout(async()=>{try{
      const response=await fetch(doc.kind==='page'?'/api/admin/pages/preview':'/api/admin/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(doc.kind==='page'?{id:doc.id,body:doc.body,css:doc.css||'',route:doc.route,collection:doc.collection}:{body:doc.body}),signal:controller.signal});
      const data=await response.json();if(controller.signal.aborted)return;if(response.ok){setPreview(data.html);setPreviewCss(data.css||'');setPreviewClass(data.className||'');setPreviewError('');}else setPreviewError(data.error||'无法生成预览');
    }catch(error){if(!controller.signal.aborted)setPreviewError(error instanceof Error?error.message:'无法生成预览');}},400);
    return()=>{clearTimeout(timer);controller.abort();};
  },[doc?.body,doc?.id,doc?.kind,doc?.css,doc?.route,doc?.collection,mode,pageMode]);
  function change(patch:Partial<Document>){const current=editing.current;if(!current)return;current.document={...current.document,...patch};setDoc(current.document);setDirty(current.session.dirty());}
  function installDocument(value:Document,remote?:{article:ClientArticle;draft:ClientEditorDraft|null},restore=false){
    const base=remote?.article||value,saved=remote?.draft;
    const baseline:Document={...base,...saved?.document,id:base.id||value.id||crypto.randomUUID(),version:base.version,status:base.status,draftVersion:saved?.draftVersion};
    const current={document:restore?{...baseline,...value}:baseline,session:null! as DraftSaveSession};
    current.session=new DraftSaveSession({
      read:()=>current.document,savedDocument:baseline,tokens:{baseVersion:base.version||null,draftVersion:saved?.draftVersion||null},
      draft:saved&&remote?{article:remote.article,draft:saved}:undefined,
      save:(snapshot,tokens)=>api('admin/editor-drafts',{articleId:current.document.id,document:snapshot,...tokens}),
      push:tokens=>api('admin/editor-drafts/'+current.document.id+'/push',tokens),
      unpublish:tokens=>api('admin/editor-drafts/'+current.document.id+'/unpublish',tokens),
      onSaved:(result,snapshot)=>{
        if(editing.current!==current)return;
        current.document={...current.document,version:result.article.version,status:result.article.status,draftVersion:result.draft.draftVersion,hasPassword:result.draft.document.hasPassword,...(current.document.password===snapshot.password?{password:undefined}:{})};
        setDoc(current.document);setDirty(current.session.dirty());
        if(new URLSearchParams(window.location.search).has('new'))window.history.replaceState(null,'',adminHref({section:current.document.kind==='page'?'pages':'articles',folder,q:query,status,edit:result.article.id}));
        setState(previous=>({...updateContent(previous,result.article),editorDrafts:[...(previous.editorDrafts||[]).filter(draft=>draft.articleId!==result.article.id),{articleId:result.article.id,title:snapshot.title||'无标题文章',folderId:snapshot.folderId,savedAt:result.draft.savedAt,baseVersion:result.draft.baseVersion,draftVersion:result.draft.draftVersion}]}));
        if(!current.session.dirty())clearRecovery();
      },
      onPushed:article=>{
        if(editing.current!==current)return;
        current.document={...current.document,version:article.version,status:article.status,draftVersion:undefined};
        setDoc(current.document);setDirty(current.session.dirty());
        setState(previous=>({...updateContent(previous,article),editorDrafts:(previous.editorDrafts||[]).filter(draft=>draft.articleId!==article.id)}));
        if(!current.session.dirty())clearRecovery();
      },
      onStatus:next=>{if(editing.current===current){setSaveStatus(next);setDirty(current.session.dirty());}},
    });
    if(saved&&saved.baseVersion!==base.version||restore&&value.version&&value.version!==base.version||restore&&value.version&&(value.draftVersion||null)!==(saved?.draftVersion||null)){
      current.session.blocked=true;setSaveStatus({phase:'error',error:'文章或编辑稿已在其他窗口修改，当前内容已保留。请重新载入后处理冲突。',blocked:true});
    }else setSaveStatus(saved?{phase:'saved',savedAt:saved.savedAt}:{phase:'idle'});
    editing.current=current;setSection(current.document.kind==='page'?'pages':'articles');setDoc(current.document);setDirty(current.session.dirty());setPreview('');setPreviewCss('');setPreviewClass('');setPreviewError('');setPageMode('html');setMenuOpen(false);setMode('visual');setBlockAvailable(false);setEditorSession(value=>value+1);
  }
  async function openDocument(input:Document|ClientArticleSummary,restore=false){
    let article:Document={...input,body:'body' in input?input.body:''};
    const request=++documentRequest.current;
    try{
      let recovery:Document|null=null,compatible=false;
      if(article.kind==='page'&&article.version&&article.contentFormat!=='html'){
        const previous=article,before=restore?await api('admin/editor-drafts/'+article.id):null;
        article=await api('admin/pages/convert',{id:article.id});
        if(restore){
          const rendered=await api('admin/preview',{body:previous.body});
          recovery={...previous,contentFormat:'html',css:previous.css??article.css??'',route:previous.route||article.route,body:rendered.html+(previous.template==='collection'?'\n<div data-page-slot="collection"></div>':'')};
          compatible=previous.version===before.article.version&&(previous.draftVersion||null)===(before.draft?.draftVersion||null);
          if(compatible)recovery.version=article.version;
        }
        await refresh();
      }
      if(article.version&&article.id){const remote=await api('admin/editor-drafts/'+article.id);if(request!==documentRequest.current)return;if(recovery&&compatible)recovery.draftVersion=remote.draft?.draftVersion;installDocument(recovery||article,remote,restore);}
      else if(request===documentRequest.current)installDocument({...article,id:article.id||crypto.randomUUID()},undefined,restore);
    }
    catch(error){if(request===documentRequest.current)toast((error as Error).message,true);}
  }
  useEffect(()=>{
    setSelected(new Set());setFolder(view.folder);setQuery(view.q);setStatus(view.status);setSection(view.section);
    documentRequest.current++;
    if(view.edit){
      if(editing.current?.document.id===view.edit)return;
      editing.current=null;setDoc(null);setDirty(false);
      const article=[...state.articles,...(state.pages||[])].find(article=>article.id===view.edit);
      if(article)void openDocument(article);else void api('admin/editor-drafts/'+encodeURIComponent(view.edit)).then(remote=>{if(new URLSearchParams(window.location.search).toString()===viewKey)return openDocument(remote.article);}).catch(error=>toast(error.message,true));
    }else if(view.new){
      if(creationRoute.current===viewKey&&editing.current)return;
      creationRoute.current=viewKey;
      const folderId=view.new==='page'?(state.folders.find(folder=>folder.path==='独立页面')?.id||'root'):state.folders.some(folder=>folder.id===view.folder)?view.folder:'root';
      void openDocument({...newDocument(folderId),...(view.new==='page'?{kind:'page' as const,contentFormat:'html' as const,css:'',route:''}:{})});
    }else{
      creationRoute.current='';restoredKey.current='';editing.current=null;setDoc(null);setDirty(false);setPreview('');setMenuOpen(false);setSettingsDraft(state.settings);setRecoveries(browserRecoveries());void refresh().catch(error=>toast(error.message,true));
    }
  },[viewKey]);
  useEffect(()=>{const update=()=>{if(!editing.current)void refresh().catch(()=>{});};window.addEventListener('focus',update);return()=>window.removeEventListener('focus',update);},[]);
  async function save(nextStatus?:'draft'|'published'){
    const current=editing.current;if(!current)throw new Error('请先选择文章');
    if(nextStatus==='published'){const article=await current.session.push();toast('网站已确认发布');return article;}
    if(nextStatus==='draft'){const result=await current.session.unpublish();toast('网站已确认撤回，编辑稿已保留');return result.article;}
    await current.session.save();return current.document;
  }
  async function upload(file:File){
    const origin=editing.current;let current=origin?.document;if(!current)return;
    if(!current.version){await save();current=origin!.document;}
    const form=new FormData();form.set('file',file);form.set('articleId',current!.id!);
    const response=await fetch('/api/admin/media',{method:'POST',body:form});
    const data=await response.json();if(!response.ok)throw new Error(data.error);
    if(editing.current===origin){if(data.type.startsWith('image/'))insertMedia({url:data.url,name:file.name,type:data.type});else if(current!.kind==='page')pageWriting.current?.insert('<a href="'+data.url+'">下载附件</a>');else writing.current?.insert('['+file.name.replace(/[\[\]]/g,'')+']('+data.url+')');}
    toast('附件已上传');
  }
  function editFolder(value?:ClientFolder){
    setFolderEdit(value?{...value}:{name:'',parentId:folder,access:'inherit',order:0});
    folderDialog.current?.showModal();
  }
  async function chooseImage(target:'body'|'cover'='body'){await run(async()=>{if(!editing.current?.document.version)await save();setImagePicker(target);});}
  function insertMedia(value:{url:string;name:string;type:string}){
    const current=editing.current?.document;if(!current)return;
    const url=value.url.startsWith('/api/media/')?value.url.split('?')[0]+'?article='+encodeURIComponent(current.id!):value.url;
    if(imagePicker==='cover'){change({cover:url});setImagePicker(null);return;}
    if(current.kind==='page'){const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));pageWriting.current?.insert(`<img src="${escape(url)}" alt="${escape(value.name)}">`);}
    else writing.current?.insert('!['+value.name.replace(/[\[\]\\]/g,'')+']('+url.replace(/\(/g,'%28').replace(/\)/g,'%29')+')');
    setImagePicker(null);
  }
  const articleFolders=state.folders.filter(f=>f.path!=='独立页面'&&!f.path.startsWith('独立页面/'));
  const activeFolder=state.folders.find(f=>f.id===folder);
  const ids=new Set([folder]);
  let added=true;while(added){added=false;for(const f of state.folders)if(ids.has(f.parentId)&&!ids.has(f.id)){ids.add(f.id);added=true;}}
  let articles=state.articles.map(article=>{const draft=draftsById.get(article.id);return draft?{...article,title:draft.title,folderId:draft.folderId}:article;}).filter(a=>(folder==='root'||ids.has(a.folderId))&&(status==='all'||a.status===status)&&a.title.toLowerCase().includes(query.toLowerCase()));
  if(folder==='root')articles=articles.toSorted((a,b)=>lastModified(b,draftsById.get(b.id)).localeCompare(lastModified(a,draftsById.get(a.id)))||a.id.localeCompare(b.id));
  const selectedArticles=state.articles.filter(article=>selected.has(article.id));
  const settingsActive=section==='settings'||section==='import';
  const saveText=saveStatus.phase==='saving'?'正在保存编辑稿…':saveStatus.phase==='error'?saveStatus.error||'保存失败':dirty?'有未保存的修改':'已保存到网站';
  return <div ref={shell} className={`admin-shell${doc?' is-writing':''}`}>
    {!doc&&<header className="admin-topbar">
      <div className="admin-topbar-start"><Link href="/admin" className="admin-brand" aria-label="返回文章管理" onNavigate={event=>navigateLink(event,adminHref())}><img src={staticAsset(state.settings.logo)} alt="站点 Logo"/></Link></div>
      <nav className="admin-primary-nav" aria-label="后台主导航">
        <Link aria-current={section==='articles'||section==='trash'?'page':undefined} href={adminHref({section:'articles'})} onNavigate={event=>navigateLink(event,adminHref({section:'articles'}))}>文章</Link>
        <Link aria-current={section==='pages'?'page':undefined} href={adminHref({section:'pages'})} onNavigate={event=>navigateLink(event,adminHref({section:'pages'}))}>页面</Link>
        <Link aria-current={section==='media'?'page':undefined} href={adminHref({section:'media'})} onNavigate={event=>navigateLink(event,adminHref({section:'media'}))}>媒体库</Link>
        <Link aria-current={settingsActive?'page':undefined} href={adminHref({section:'settings'})} onNavigate={event=>navigateLink(event,adminHref({section:'settings'}))}>设置</Link>
      </nav>
      <nav className="admin-account-nav" aria-label="账户操作">
        <Link className="text-button" href={adminHref({section:'updates'})} onNavigate={event=>navigateLink(event,adminHref({section:'updates'}))}>更新</Link>
        <Link href="/" target="_blank" aria-label="访问博客"><span>访问博客</span><ArrowUpRight size={16}/></Link><button type="button" aria-label="退出" disabled={busy} onClick={()=>requestLeave(()=>{run(async()=>{await api('logout',{});router.push('/admin/login');router.refresh();});})}><LogOut size={16}/><span>退出</span></button>
      </nav>
    </header>}
    <div className="admin-workspace"><main id="main" className="admin-main">
      {notice&&<div className={'admin-notice'+(notice.error?' error':'')} role="status"><span>{notice.text}</span><button aria-label="关闭提示" onClick={()=>setNotice(null)}><X size={14}/></button></div>}
      {section==='media'&&!doc&&<MediaLibrary onChanged={()=>void refresh()}/>}
      {section==='updates'&&!doc&&<ProgramUpdates/>}
      {section==='articles'&&!doc&&<>
        <div className="admin-page-heading"><h1>{folder==='root'?'最近修改':activeFolder?.name}</h1><div className="admin-actions">
          <Link className="button secondary" href={adminHref({section:'trash'})} onNavigate={event=>navigateLink(event,adminHref({section:'trash'}))}><Trash2 size={15}/>回收站<span className="count-badge">{state.trash.length}</span></Link>
          {folder!=='root'&&<button className="button secondary" onClick={()=>editFolder(activeFolder)}>编辑文件夹</button>}
          <Link className="button primary" href={adminHref({section:'articles',folder,new:'post'})} onNavigate={event=>navigateLink(event,adminHref({section:'articles',folder,new:'post'}))}><Plus size={15}/>写文章</Link>
        </div></div>
        {recoveries.map(recovery=><div className="admin-notice" key={recovery.key}><span>发现未保存的编辑：「{recovery.document.title||'无标题'}」</span><div className="admin-actions"><button onClick={()=>void openDocument(recovery.document,true).then(()=>{restoredKey.current=recovery.key;creationRoute.current=new URL(adminHref({section:recovery.document.kind==='page'?'pages':'articles',folder:recovery.document.folderId,new:recovery.document.kind==='page'?'page':'post'}),window.location.origin).searchParams.toString();window.history.pushState(null,'',adminHref({section:recovery.document.kind==='page'?'pages':'articles',folder:recovery.document.folderId,edit:recovery.document.version?recovery.document.id:undefined,new:recovery.document.version?undefined:recovery.document.kind==='page'?'page':'post'}));})}>恢复编辑</button><button onClick={()=>{removeBrowserRecovery(recovery.key);setRecoveries(browserRecoveries());}}>忽略</button></div></div>)}
        <div className="admin-catalog">
          <nav className="admin-catalog-tree" aria-label="文章分类">
            <div className="section-label"><span>分类</span><button className="text-button" onClick={()=>editFolder()}><FolderPlus size={15}/>新建文件夹</button></div>
            <FolderTree folders={articleFolders} current={folder} rootLabel="最近修改" hrefFor={id=>adminHref({section:'articles',folder:id,q:query,status})} onNavigate={navigateLink}/>
          </nav>
          <section className="admin-catalog-content" aria-label="文章列表">
            <div className="admin-filters">
              <input value={query} onChange={e=>filter({q:e.target.value})} placeholder="搜索文章标题…" aria-label="搜索文章"/>
              <select value={status} onChange={e=>filter({status:e.target.value})} aria-label="发布状态"><option value="all">全部状态</option><option value="published">已发布</option><option value="draft">草稿</option></select>
              <button className="button secondary" aria-label="重建索引" onClick={()=>run(async()=>{const r=await api('admin/reindex',{});await refresh();toast('已重建 '+r.count+' 篇文章的索引');})} title="本地修改文件后，重新扫描内容"><RotateCcw size={14}/></button>
              <a className="button secondary" href="/api/admin/export" aria-label="导出 Markdown 与附件" title="导出 Markdown 与附件"><Download size={14}/></a>
            </div>
            <div className="admin-selection-bar"><label><input type="checkbox" aria-label="全选当前筛选结果" checked={!!articles.length&&articles.every(article=>selected.has(article.id))} ref={element=>{if(element)element.indeterminate=articles.some(article=>selected.has(article.id))&&!articles.every(article=>selected.has(article.id));}} onChange={event=>setSelected(event.target.checked?new Set(articles.map(article=>article.id)):new Set())}/>全选当前筛选结果</label>{selected.size>0&&<><span>已选 {selected.size} 篇</span><BatchActions articles={selectedArticles} drafts={state.editorDrafts||[]} folders={articleFolders} onDone={async()=>{await refresh();setSelected(new Set());toast('批量操作完成');}}/></>}</div>
            <div className="admin-article-list admin-post-list">{articles.map(a=><article className="admin-article-card" key={a.id} data-article-id={a.id}>
              <input className="article-select" type="checkbox" aria-label={'选择 '+a.title} checked={selected.has(a.id)} onChange={event=>setSelected(previous=>{const next=new Set(previous);if(event.target.checked)next.add(a.id);else next.delete(a.id);return next;})}/>
              <div className="admin-card-content"><div className="admin-card-heading"><div className="admin-card-status"><span className={'status-label '+a.status}>{a.status==='published'?'已发布':'草稿'}</span>{a.status==='published'&&draftsById.has(a.id)&&<span className="status-label pending-draft">有未发布修改</span>}</div><h2><Link className="article-title-button" href={adminHref({section:'articles',folder,q:query,status,edit:a.id})} onNavigate={event=>navigateLink(event,adminHref({section:'articles',folder,q:query,status,edit:a.id}))}>{a.title}</Link></h2></div>
              <div className="admin-card-meta">
                <span><FolderClosed size={13}/>{a.folderId==='root'?'根目录':state.folders.find(f=>f.id===a.folderId)?.name||'根目录'}</span>
                <span className="privacy-label">{a.access==='password'?<LockKeyhole size={12}/>:a.access==='private'?<Shield size={12}/>:<Globe size={12}/>} {accessNames[a.access||'inherit']}</span>
                <span>更新于 <time dateTime={lastModified(a,draftsById.get(a.id))}>{dateText(lastModified(a,draftsById.get(a.id)))}</time></span>
              </div></div>
              <div className="admin-card-actions">
                <Link className="text-button" href={adminHref({section:'articles',folder,q:query,status,edit:a.id})} onNavigate={event=>navigateLink(event,adminHref({section:'articles',folder,q:query,status,edit:a.id}))} aria-label={'编辑 '+a.title}><Pencil size={14}/>编辑</Link>
                <OpenArticle article={a}/>
                <button className="text-button" onClick={()=>{if(window.confirm('将「'+a.title+'」移入回收站？'))run(async()=>{await api('admin/trash',{id:a.id,kind:'article'});await refresh();toast('已移入回收站');});}} aria-label={'删除 '+a.title}><Trash2 size={14}/>删除</button>
              </div>
            </article>)}</div>
            {!articles.length&&<div className="empty-state"><FileText size={30}/><h3>{query||status!=='all'?'没有符合条件的文章':'在这里，写下新的记录。'}</h3><p>创建一篇文章，或在设置中从 WordPress 导入已有内容。</p><Link className="outline-link" href={adminHref({section:'articles',folder,new:'post'})} onNavigate={event=>navigateLink(event,adminHref({section:'articles',folder,new:'post'}))}>写文章 <Plus size={14}/></Link></div>}
          </section>
        </div>
      </>}
      {section==='pages'&&!doc&&<>
        <div className="admin-page-heading"><h1>页面</h1><div className="admin-actions"><Link className="button secondary" href={adminHref({section:'trash'})} onNavigate={event=>navigateLink(event,adminHref({section:'trash'}))}><Trash2 size={15}/>回收站</Link><Link className="button primary" href={adminHref({section:'pages',new:'page'})} onNavigate={event=>navigateLink(event,adminHref({section:'pages',new:'page'}))}><Plus size={15}/>新建页面</Link></div></div>
        <div className="admin-filters"><input aria-label="搜索页面" placeholder="搜索页面标题或地址…" value={query} onChange={event=>filter({q:event.target.value})}/><select aria-label="页面发布状态" value={status} onChange={event=>filter({status:event.target.value})}><option value="all">全部状态</option><option value="published">已发布</option><option value="draft">草稿</option></select></div>
        <div className="admin-article-list">{(state.pages||[]).filter(page=>(status==='all'||page.status===status)&&(page.title+' '+(page.route||'')).toLowerCase().includes(query.toLowerCase())).map(page=><article className="admin-article-card" key={page.id}>
          <div className="admin-card-content"><div className="admin-card-heading"><h2><Link className="article-title-button" href={adminHref({section:'pages',edit:page.id})} onNavigate={event=>navigateLink(event,adminHref({section:'pages',edit:page.id}))}>{draftsById.get(page.id)?.title||page.title}</Link></h2><div className="admin-card-status"><span className={'status-label '+page.status}>{page.status==='published'?'已发布':'草稿'}</span>{draftsById.has(page.id)&&<span className="status-label pending-draft">有未发布修改</span>}</div></div>
          {page.summary&&<p className="admin-card-summary">{page.summary}</p>}
          <div className="admin-card-meta"><code>{page.route||page.aliases[0]||'/posts/'+page.id}</code><span>HTML + CSS</span><span>{accessNames[page.access||'inherit']}</span><span>更新于 <time dateTime={page.updatedAt}>{dateText(page.updatedAt)}</time></span></div></div>
          <div className="admin-card-actions"><Link className="text-button" href={adminHref({section:'pages',edit:page.id})} onNavigate={event=>navigateLink(event,adminHref({section:'pages',edit:page.id}))}><Pencil size={14}/>编辑</Link><OpenArticle article={page}/><button className="text-button" onClick={()=>{if(window.confirm('将「'+page.title+'」移入回收站？'))run(async()=>{await api('admin/trash',{id:page.id,kind:'article'});await refresh();toast('页面已移入回收站');});}}><Trash2 size={14}/>删除</button></div>
        </article>)}</div>
        {!(state.pages||[]).length&&<div className="empty-state"><h3>暂无页面</h3><p>新建页面后，直接编辑 HTML 与 CSS。</p></div>}
      </>}
      {doc&&<>
        <WritingMenu exitHref={listHref} onExitNavigate={event=>navigateLink(event,listHref)} entity={doc.kind==='page'?'页面':'文章'} open={menuOpen} onOpenChange={open=>{if(open)writing.current?.closePanels();setMenuOpen(open);}} status={saveText} statusKind={saveStatus.phase==='error'?'error':saveStatus.phase==='saving'?'saving':dirty?'dirty':'saved'}>
          <div className={'writing-draft-status'+(saveStatus.phase==='error'?' error':'')} role="status"><strong>{saveText}</strong><span title={doc.status==='published'?'保存编辑稿不会更新前台':'草稿仅管理员可见'}>{doc.status==='published'?'已发布 · 当前编辑仍为草稿':'草稿 · 尚未发布'}</span>{saveStatus.savedAt&&<time dateTime={saveStatus.savedAt}>上次保存 {new Date(saveStatus.savedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time>}</div>
          <div className="writing-action-group"><div className="writing-menu-actions">
            <button className="button primary writing-publish" disabled={busy||saveStatus.blocked} onClick={()=>run(async()=>{await save('published');})}>{doc.status==='published'?'更新到网站':doc.kind==='page'?'发布页面':'发布文章'}<ArrowRight size={15}/></button>

            <button className="button secondary" disabled={busy||saveStatus.blocked} onClick={()=>run(async()=>{await save();})}><Save size={15}/>保存</button>
            <OpenArticle article={publishedArticle} className="button secondary"/>
            <button className="button secondary" disabled={!fullscreenAvailable} onClick={()=>run(async()=>{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();})}>{fullscreen?<Minimize2 size={15}/>:<Maximize2 size={15}/>} {fullscreen?'还原':'全屏'}</button>
          </div></div>
          {doc.status==='published'&&<button className="text-button writing-unpublish" disabled={busy||saveStatus.blocked} onClick={()=>run(async()=>{await save('draft');})}>撤回为草稿</button>}
          {doc.kind!=='page'&&<div className="writing-mobile-tools"><div className="writing-view-modes" role="group" aria-label="编辑模式">{([['visual','可视化'],['code','源码'],['preview','预览']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={mode===value} className={mode===value?'active':''} onClick={()=>{setMode(value);setMenuOpen(false);}}>{label}</button>)}</div><button className="button secondary" disabled={!blockAvailable||mode==='preview'} onClick={()=>{setMenuOpen(false);setTimeout(()=>writing.current?.openBlockSettings(),0);}}><PanelRight size={15}/>区块设置</button></div>}
          <h3 className="writing-menu-section-title">{doc.kind==='page'?'页面设置':'文章设置'}</h3>{doc.kind==='page'?<PageSettings doc={doc as PageDocument} onChange={change}/>:<ArticleSettings doc={doc} folders={articleFolders} onChange={change} onChooseCover={()=>void chooseImage('cover')}/>}
        </WritingMenu>
        <section className="writing-desk" aria-label={doc.kind==='page'?'页面编辑':'文章编辑'}>
          <div className={'writing-column'+(doc.kind==='page'?' page-writing-column':'')}><Link className="text-button editor-exit-link" href={listHref} onNavigate={event=>navigateLink(event,listHref)}><ChevronLeft size={16}/>退出编辑</Link>{doc.kind==='page'?<PageEditor key={editorSession} editorRef={pageWriting} onModeChange={setPageMode} doc={doc as PageDocument} folders={articleFolders} onChange={change} onUpload={file=>void run(()=>upload(file))} onChooseMedia={()=>void chooseImage('body')} preview={preview} previewCss={previewCss} previewClass={previewClass} previewError={previewError}/>:<WritingEditor key={editorSession} editorRef={writing} doc={doc} dirty={dirty} mode={mode} onModeChange={setMode} preview={preview} onChange={change} onUpload={file=>void run(()=>upload(file))} onChooseMedia={()=>void chooseImage('body')} onBlockAvailabilityChange={setBlockAvailable} onError={message=>toast(message,true)}/>}</div>
        </section>
      </>}
      {section==='trash'&&<>
        <Link className="text-button admin-tool-back" href={adminHref()} onNavigate={event=>navigateLink(event,adminHref())}><ChevronLeft size={15}/>返回文章管理</Link>
        <div className="admin-page-heading"><h1>回收站</h1><span className="count-badge">{state.trash.length} 项</span></div>
        <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>内容</th><th>移除日期</th><th>操作</th></tr></thead><tbody>{state.trash.map(t=><tr key={t.id}><td>{t.title}<small>{t.kind==='folder'?'文件夹':'文章'} · {t.originalPath}</small></td><td>{dateText(t.time)}</td><td><button className="text-button" onClick={()=>run(async()=>{await api('admin/restore',{id:t.id});await refresh();toast('已恢复到原位置');})}><RotateCcw size={13}/>恢复</button></td></tr>)}</tbody></table></div>
        {!state.trash.length&&<div className="empty-state"><Trash2 size={27}/><h3>回收站是空的。</h3></div>}
      </>}
      {section==='settings'&&<SettingsPanel onNavigate={navigateLink} settings={settingsDraft} folders={state.folders} busy={busy} onChange={setSettingsDraft} onSave={settings=>run(async()=>{await api('admin/settings',settings);const next=await refresh();setSettingsDraft(next.settings);toast('站点设置已保存');})}/>}
      {section==='import'&&<><Link className="text-button admin-tool-back" href={adminHref({section:'settings'})} onNavigate={event=>navigateLink(event,adminHref({section:'settings'}))}><ChevronLeft size={15}/>返回站点设置</Link><div className="admin-page-heading"><h1>导入／导出</h1></div><section className="export-options" aria-label="导出数据"><h2>导出</h2><a className="button secondary" href="/api/admin/export"><Download size={15}/>导出 Markdown 与附件</a><a className="button secondary" href="/api/admin/backup"><Download size={15}/>下载整站备份</a></section><ImportPanel folders={state.folders} onDone={async()=>{await refresh();}} toast={toast}/></>}
    </main></div>
    {imagePicker&&<ImagePicker title={imagePicker==='cover'?'设置封面图片':'插入图片'} onClose={()=>setImagePicker(null)} onSelect={insertMedia} onUpload={upload}/>}
    <dialog className="unsaved-dialog" aria-labelledby="unsaved-title" ref={leaveDialog} onCancel={()=>{pendingLeave.current=null;}}>
      <h2 id="unsaved-title">有未保存的修改</h2><p>离开后，当前修改将不会保存。</p>
      <div className="admin-actions"><button type="button" className="button secondary" autoFocus onClick={cancelLeave}>继续编辑</button><button type="button" className="button primary" onClick={discardAndLeave}>不保存并离开</button></div>
    </dialog>
    <dialog className="folder-modal" ref={folderDialog}>
      <div className="modal-heading"><h2>{folderEdit.id?'编辑文件夹':'新建文件夹'}</h2><button className="icon-button" onClick={()=>folderDialog.current?.close()} aria-label="关闭"><X size={18}/></button></div>
      <form onSubmit={e=>{e.preventDefault();run(async()=>{await api('admin/folders',folderEdit);await refresh();folderDialog.current?.close();toast('文件夹已保存');});}}>
        <label>文件夹名称<input autoFocus required value={folderEdit.name||''} onChange={e=>setFolderEdit(f=>({...f,name:e.target.value}))}/></label>
        <label>上级目录<select value={folderEdit.parentId||'root'} onChange={e=>setFolderEdit(f=>({...f,parentId:e.target.value}))}><FolderOptions folders={state.folders.filter(f=>f.id!==folderEdit.id&&(!folderEdit.path||!f.path.startsWith(folderEdit.path+'/')))}/></select></label>
        <label>访问权限<select value={folderEdit.access||'inherit'} onChange={e=>setFolderEdit(f=>({...f,access:e.target.value as Folder['access']}))}>{Object.entries(accessNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        {folderEdit.access==='password'&&<label>{folderEdit.hasPassword?'更换密码（留空保持）':'访问密码'}<input type="password" autoComplete="new-password" value={folderEdit.password||''} onChange={e=>setFolderEdit(f=>({...f,password:e.target.value}))}/></label>}
        <label>排序权重<input type="number" value={folderEdit.order||0} onChange={e=>setFolderEdit(f=>({...f,order:Number(e.target.value)}))}/></label>
        <p className="small muted">子文章继承此权限，不能放宽上级限制。</p>
        <div className="admin-actions">
          {folderEdit.id&&folderEdit.id!=='root'&&<button type="button" className="text-button" style={{color:'var(--danger)',marginRight:'auto'}} onClick={()=>{if(window.confirm('将整个文件夹及其内容移入回收站？'))run(async()=>{await api('admin/trash',{id:folderEdit.id,kind:'folder'});await refresh();setFolder('root');folderDialog.current?.close();toast('文件夹已移入回收站');});}}><Trash2 size={13}/>移入回收站</button>}
          <button className="button secondary" type="button" onClick={()=>folderDialog.current?.close()}>取消</button><button className="button primary" disabled={busy}>保存</button>
        </div>
      </form>
    </dialog>
  </div>;
}

function SettingsPanel({settings:value,folders,busy,onSave,onChange,onNavigate}:{settings:SiteSettings;folders:ClientFolder[];busy:boolean;onSave:(s:SiteSettings)=>void;onChange:(s:SiteSettings)=>void;onNavigate:(event:{preventDefault:()=>void},href:string)=>void}){
 const set=(patch:Partial<SiteSettings>)=>onChange({...value,...patch});return <form onSubmit={e=>{e.preventDefault();onSave(value);}}><div className="admin-page-heading"><div><h1>站点设置</h1></div><div className="admin-actions"><Link className="button secondary" href={adminHref({section:'import'})} onNavigate={event=>onNavigate(event,adminHref({section:'import'}))}><Upload size={14}/>导入／导出</Link><button className="button primary" disabled={busy}><Save size={14}/>保存设置</button></div></div><div className="settings-grid"><h2 className="settings-section-title settings-wide">基本信息</h2>{([['title','站点名称'],['subtitle','站点副标题'],['email','联系邮箱'],['logo','Logo 地址'],['description','站点简介'],['footer','备案号']] as const).map(([k,label])=><label className="settings-field" key={k}>{label}<input value={value[k]} onChange={e=>set({[k]:e.target.value})}/></label>)}<label className="settings-field settings-wide">前台目录根文件夹<select value={value.knowledgeRootId||folders.find(f=>f.path==='博客')?.id||''} onChange={e=>set({knowledgeRootId:e.target.value})}><option value="">未选择</option><FolderOptions folders={folders} excludeRoot/></select></label><h2 className="settings-section-title settings-wide">导航</h2><div className="settings-wide">{value.navigation.map((n,i)=><div className="setting-nav-row" key={i}><input aria-label="导航标题" value={n.label} onChange={e=>set({navigation:value.navigation.map((x,j)=>i===j?{...x,label:e.target.value}:x)})}/><input aria-label="导航链接" value={n.href} onChange={e=>set({navigation:value.navigation.map((x,j)=>i===j?{...x,href:e.target.value}:x)})}/><button type="button" onClick={()=>set({navigation:value.navigation.filter((_,j)=>j!==i)})} aria-label="删除导航"><X size={16}/></button></div>)}<button className="text-button" type="button" onClick={()=>set({navigation:[...value.navigation,{label:'新链接',href:'/knowledge'}]})}><Plus size={14}/>添加导航</button></div><h2 className="settings-section-title settings-wide">首页内容</h2><div className="settings-box settings-wide"><p style={{marginTop:0,marginBottom:12}}>选择首页展示的文件夹；不选择时显示所有已发布博客文章，独立页面不进入文章列表。</p>{folders.filter(f=>f.id!=='root').map(f=><label key={f.id}><input type="checkbox" checked={value.homeFolders.includes(f.id)} onChange={e=>set({homeFolders:e.target.checked?[...value.homeFolders,f.id]:value.homeFolders.filter(id=>id!==f.id)})}/>{f.path}</label>)}</div><h2 className="settings-section-title settings-wide">Giscus 评论</h2><div className="settings-box settings-wide"><label><input type="checkbox" checked={value.giscus.enabled} onChange={e=>set({giscus:{...value.giscus,enabled:e.target.checked}})}/>公开文章启用评论</label><p>密码和私密文章始终关闭评论。Giscus 评论存储在公开的 GitHub Discussions。</p></div>{([['repo','仓库（owner/repo）'],['repoId','仓库 ID'],['category','Discussion 分类'],['categoryId','分类 ID']] as const).map(([k,label])=><label className="settings-field" key={k}>{label}<input value={value.giscus[k]} onChange={e=>set({giscus:{...value.giscus,[k]:e.target.value}})}/></label>)}</div></form>;
}

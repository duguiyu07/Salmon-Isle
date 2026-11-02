'use client';
import Link from 'next/link';
import { useEffect,useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus,FolderPlus,FileText,FolderClosed,Upload,Trash2,Download,LogOut,ArrowUpRight,ChevronLeft,Save,LockKeyhole,Globe,Shield,RotateCcw,Pencil,X,Check,LoaderCircle,ArrowRight,PanelRight,Maximize2,Minimize2 } from 'lucide-react';
import { Article,Folder,SiteSettings } from '@/lib/model';
import { ImportAnalysis,ImportChoice } from '@/lib/wordpress';
import { FolderTree } from './folder-tree';
import { dateText } from './article-card';
import { MarkdownBody } from './reader';
import { WritingEditor,WritingHandle,type EditorMode } from './writing-editor';
import {ArticleSettings} from './article-settings';
import {WritingMenu} from './writing-menu';
import {PageEditor,type PageEditorHandle} from './page-editor';
import type {PageDocument} from '@/lib/editor-draft-model';
import {DraftSaveSession,type SaveStatus} from '@/lib/draft-save-session';
import type {EditorDraftSummary,ClientEditorDraft} from '@/lib/editor-draft-model';
import {MediaLibrary,ImagePicker} from './media-library';
import {GitPanel,RepositoryIndicator} from './git-panel';
import {ProgramUpdates} from './program-updates';
type ClientArticle=Omit<Article,'passwordHash'>&{hasPassword:boolean};
type ClientFolder=Omit<Folder,'passwordHash'>&{hasPassword:boolean};
type Trash={id:string;kind:string;title:string;originalPath:string;time:string};
type State={articles:ClientArticle[];pages?:ClientArticle[];editorDrafts?:EditorDraftSummary[];folders:ClientFolder[];settings:SiteSettings;trash:Trash[];desktop?:boolean;gitEnabled?:boolean};
type Document=Partial<ClientArticle>&{title:string;body:string;folderId:string;password?:string;draftVersion?:string};
async function api(url:string,data?:unknown){const response=await fetch('/api/'+url,data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error||'操作失败'),{status:response.status});return result;}
const accessNames={inherit:'继承上级',public:'公开',password:'密码保护',private:'私密'};
const newDocument=(folderId='root'):Document=>({id:crypto.randomUUID(),title:'',body:'',folderId,kind:'post',status:'draft',access:'inherit',summary:'',order:0,pinned:false});
function updateContent(state:State,article:ClientArticle):State{return {...state,articles:[...state.articles.filter(a=>a.id!==article.id),...(article.kind==='post'?[article]:[])],pages:[...(state.pages||[]).filter(a=>a.id!==article.id),...(article.kind==='page'?[article]:[])]};}

export function AdminWorkspace({initial}:{initial:State}){
  const [state,setState]=useState(initial);
  const [imagePicker,setImagePicker]=useState(false);
  const [section,setSection]=useState(initial.desktop&&!initial.gitEnabled?'commits':'articles');
  useEffect(()=>{if(new URLSearchParams(window.location.search).get('section')==='commits')setSection('commits');},[]);
  const [folder,setFolder]=useState('root');
  const [query,setQuery]=useState('');
  const [status,setStatus]=useState('all');
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
  const [previewCss,setPreviewCss]=useState(''),[previewClass,setPreviewClass]=useState(''),[previewError,setPreviewError]=useState('');
  const [recovery,setRecovery]=useState<Document|null>(null);
  const [folderEdit,setFolderEdit]=useState<Partial<ClientFolder>&{password?:string}>({});
  const folderDialog=useRef<HTMLDialogElement>(null);
  const leaveDialog=useRef<HTMLDialogElement>(null);
  const pendingLeave=useRef<(()=>void)|null>(null);
  const writing=useRef<WritingHandle>(null);
  const pageWriting=useRef<PageEditorHandle>(null);
  const router=useRouter();
  useEffect(()=>{window.salmonSaveBeforeExit=()=>editing.current?.session.save()||Promise.resolve();return()=>{delete window.salmonSaveBeforeExit;};},[]);
  const toast=(text:string,error=false)=>setNotice({text,error});
  const clearRecovery=()=>{try{localStorage.removeItem('salmon-editor-recovery');}catch{}void window.salmonDesktop?.clearRecovery().catch(()=>{});setRecovery(null);};
  useEffect(()=>{setFullscreenAvailable(!!document.fullscreenEnabled);const change=()=>setFullscreen(!!document.fullscreenElement);document.addEventListener('fullscreenchange',change);return()=>document.removeEventListener('fullscreenchange',change);},[]);
  useEffect(()=>{const current=editing.current;if(!doc||!current)return;const timer=current.session.startAutosave();return()=>clearInterval(timer);},[editorSession,!!doc]);
  async function refresh(){const data=await api('admin/state');setState(data);return data as State;}
  async function run(action:()=>Promise<void>){setBusy(true);try{await action();}catch(e){toast((e as Error).message,true);}finally{setBusy(false);}}
  function requestLeave(action:()=>void){
    if(!dirty&&!settingsDirty){action();return;}
    pendingLeave.current=action;leaveDialog.current?.showModal();
  }
  function cancelLeave(){pendingLeave.current=null;leaveDialog.current?.close();}
  function discardAndLeave(){const action=pendingLeave.current;pendingLeave.current=null;leaveDialog.current?.close();action?.();}
  useEffect(()=>{
    const callback=(event:BeforeUnloadEvent)=>{if(dirty||settingsDirty)event.preventDefault();};
    window.addEventListener('beforeunload',callback);
    return()=>window.removeEventListener('beforeunload',callback);
  },[dirty,settingsDirty]);
  useEffect(()=>{try{const raw=localStorage.getItem('salmon-editor-recovery');if(raw)setRecovery(JSON.parse(raw));else void window.salmonDesktop?.readRecovery().then(value=>{if(value)setRecovery(JSON.parse(value));}).catch(()=>{});}catch{}},[]);
  useEffect(()=>{
    if(!dirty||!doc)return;
    const timer=setTimeout(()=>{try{const {password:_password,...recoverable}=doc;const value=JSON.stringify(recoverable);localStorage.setItem('salmon-editor-recovery',value);void window.salmonDesktop?.writeRecovery(value).catch(()=>{});}catch{}},1000);
    return()=>clearTimeout(timer);
  },[doc,dirty]);
  useEffect(()=>{
    if(!doc)return;
    const controller=new AbortController();
    const timer=setTimeout(async()=>{try{
      const response=await fetch(doc.kind==='page'?'/api/admin/pages/preview':'/api/admin/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(doc.kind==='page'?{id:doc.id,body:doc.body,css:doc.css||'',route:doc.route,collection:doc.collection}:{body:doc.body}),signal:controller.signal});
      const data=await response.json();if(response.ok){setPreview(data.html);setPreviewCss(data.css||'');setPreviewClass(data.className||'');setPreviewError('');}else setPreviewError(data.error||'无法生成预览');
    }catch{}},400);
    return()=>{clearTimeout(timer);controller.abort();};
  },[doc?.body,doc?.id,doc?.css,doc?.route,doc?.collection]);
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
        setState(previous=>({...updateContent(previous,result.article),editorDrafts:[...(previous.editorDrafts||[]).filter(draft=>draft.articleId!==result.article.id),{articleId:result.article.id,title:snapshot.title||'无标题文章',folderId:snapshot.folderId,savedAt:result.draft.savedAt}]}));
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
    editing.current=current;setSection(current.document.kind==='page'?'pages':'articles');setDoc(current.document);setDirty(current.session.dirty());setPreview('');setMenuOpen(false);setMode('visual');setBlockAvailable(false);setEditorSession(value=>value+1);
  }
  async function openDocument(article:Document,restore=false){
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
      if(article.version&&article.id){const remote=await api('admin/editor-drafts/'+article.id);if(recovery&&compatible)recovery.draftVersion=remote.draft?.draftVersion;installDocument(recovery||article,remote,restore);}
      else installDocument({...article,id:article.id||crypto.randomUUID()},undefined,restore);
    }
    catch(error){toast((error as Error).message,true);}
  }
  function switchDocument(article:Document|null){
    requestLeave(()=>{if(article){void openDocument(article);}else{editing.current=null;setDoc(null);setDirty(false);setPreview('');setMenuOpen(false);}});
  }
  function go(to:string){
    if(to===section&&!doc)return;
    requestLeave(()=>{setSection(to);editing.current=null;setDoc(null);setDirty(false);setPreview('');setMenuOpen(false);setSettingsDraft(state.settings);});
  }
  async function save(nextStatus?:'draft'|'published'){
    const current=editing.current;if(!current)throw new Error('请先选择文章');
    if(nextStatus==='published'){const article=await current.session.push();toast(state.gitEnabled?'已准备发布，请在待提交页面提交并推送':'修改已发布');return article;}
    if(nextStatus==='draft'){const result=await current.session.unpublish();toast(state.gitEnabled?'已准备撤回，请在待提交页面提交并推送':'文章已撤回，编辑稿已保留');return result.article;}
    await current.session.save();return current.document;
  }
  async function upload(file:File){await run(async()=>{
    const origin=editing.current;let current=origin?.document;if(!current)return;
    if(!current.version){await save();current=origin!.document;}
    const form=new FormData();form.set('file',file);form.set('articleId',current!.id!);
    const response=await fetch('/api/admin/media',{method:'POST',body:form});
    const data=await response.json();if(!response.ok)throw new Error(data.error);
    if(editing.current===origin){if(current!.kind==='page')pageWriting.current?.insert(data.type.startsWith('image/')?`<img src="${data.url}" alt="">`:`<a href="${data.url}">下载附件</a>`);else writing.current?.insert((data.type.startsWith('image/')?'!':'')+'['+file.name.replace(/[\[\]]/g,'')+']('+data.url+')');}
    toast('附件已上传');
  });}
  function editFolder(value?:ClientFolder){
    setFolderEdit(value?{...value}:{name:'',parentId:folder,access:'inherit',order:0});
    folderDialog.current?.showModal();
  }
  async function chooseImage(){await run(async()=>{if(!editing.current?.document.version)await save();setImagePicker(true);});}
  function insertMedia(value:{url:string;name:string;type:string}){
    const current=editing.current?.document;if(!current)return;
    const url=value.url.startsWith('/api/media/')?value.url+'?article='+encodeURIComponent(current.id!):value.url;
    if(current.kind==='page'){const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));pageWriting.current?.insert(`<img src="${escape(url)}" alt="${escape(value.name)}">`);}
    else writing.current?.insert('!['+value.name.replace(/[\[\]\\]/g,'')+']('+url.replace(/\(/g,'%28').replace(/\)/g,'%29')+')');
    setImagePicker(false);
  }
  const articleFolders=state.folders.filter(f=>f.path!=='独立页面'&&!f.path.startsWith('独立页面/'));
  const activeFolder=state.folders.find(f=>f.id===folder);
  const ids=new Set([folder]);
  let added=true;while(added){added=false;for(const f of state.folders)if(ids.has(f.parentId)&&!ids.has(f.id)){ids.add(f.id);added=true;}}
  const articles=state.articles.map(article=>{const draft=state.editorDrafts?.find(value=>value.articleId===article.id);return draft?{...article,title:draft.title,folderId:draft.folderId}:article;}).filter(a=>(folder==='root'||ids.has(a.folderId))&&(status==='all'||a.status===status)&&a.title.toLowerCase().includes(query.toLowerCase()));
  const settingsActive=section==='settings'||section==='import';
  const saveText=saveStatus.phase==='saving'?'正在保存编辑稿…':saveStatus.phase==='error'?saveStatus.error||'保存失败':dirty?'有未保存的修改':saveStatus.savedAt?'编辑稿已保存':'已保存';
  return <div ref={shell} className={`admin-shell${doc?' is-writing':''}`}>
    {!doc&&<header className="admin-topbar">
      <div className="admin-topbar-start"><Link href="/admin" className="admin-brand" aria-label="返回文章管理" onClick={e=>{e.preventDefault();go('articles');}}><img src={state.settings.logo} alt="站点 Logo"/></Link></div>
      <nav className="admin-primary-nav" aria-label="后台主导航">
        <button type="button" aria-current={section==='articles'||section==='trash'?'page':undefined} onClick={()=>go('articles')}>文章</button>
        <button type="button" aria-current={section==='pages'?'page':undefined} onClick={()=>go('pages')}>页面</button>
        <button type="button" aria-current={section==='media'?'page':undefined} onClick={()=>go('media')}>媒体库</button>
        <button type="button" aria-current={section==='commits'?'page':undefined} onClick={()=>go('commits')}>提交</button>
        {!state.desktop&&<button type="button" aria-current={settingsActive?'page':undefined} onClick={()=>go('settings')}>设置</button>}
      </nav>
      <nav className="admin-account-nav" aria-label="账户操作">
        <button type="button" className="text-button" onClick={()=>go('updates')}>更新</button>
        {state.gitEnabled&&<RepositoryIndicator onOpen={()=>go('commits')}/>}
        {state.desktop?<button className="text-button" onClick={()=>go('commits')}>仓库连接</button>:<><Link href="/" target="_blank" aria-label="访问博客"><span>访问博客</span><ArrowUpRight size={16}/></Link><button type="button" aria-label="退出" disabled={busy} onClick={()=>requestLeave(()=>{run(async()=>{await api('logout',{});localStorage.removeItem('salmon-editor-recovery');router.push('/admin/login');router.refresh();});})}><LogOut size={16}/><span>退出</span></button></>}
      </nav>
    </header>}
    <div className="admin-workspace"><main id="main" className="admin-main">
      {notice&&<div className={'admin-notice'+(notice.error?' error':'')} role="status"><span>{notice.text}</span><button aria-label="关闭提示" onClick={()=>setNotice(null)}><X size={14}/></button></div>}
      {state.desktop&&!state.gitEnabled&&!doc&&<div className="admin-notice"><span>连接私有内容仓库后，即可离线编辑并同步网站。</span><button onClick={()=>go('commits')}>连接仓库</button></div>}
      {section==='media'&&!doc&&<MediaLibrary onChanged={()=>void refresh()}/>}
      {section==='commits'&&!doc&&<GitPanel desktop={!!state.desktop} onChanged={refresh}/>}
      {section==='updates'&&!doc&&<ProgramUpdates desktop={!!state.desktop}/>}
      {section==='articles'&&!doc&&<>
        <div className="admin-page-heading"><h1>{folder==='root'?'文章与笔记':activeFolder?.name}</h1><div className="admin-actions">
          <button className="button secondary" onClick={()=>go('trash')}><Trash2 size={15}/>回收站<span className="count-badge">{state.trash.length}</span></button>
          {folder!=='root'&&<button className="button secondary" onClick={()=>editFolder(activeFolder)}>编辑文件夹</button>}
          <button className="button primary" onClick={()=>switchDocument(newDocument(folder))}><Plus size={15}/>写文章</button>
        </div></div>
        {recovery&&<div className="admin-notice"><span>发现上次未保存的编辑：「{recovery.title||'无标题'}」</span><div className="admin-actions">
          <button onClick={()=>void openDocument(recovery,true)}>恢复编辑</button>
          <button onClick={()=>{setRecovery(null);localStorage.removeItem('salmon-editor-recovery');}}>忽略</button>
        </div></div>}
        <div className="admin-catalog">
          <nav className="admin-catalog-tree" aria-label="文章分类">
            <div className="section-label"><span>分类</span><button className="text-button" onClick={()=>editFolder()}><FolderPlus size={15}/>新建文件夹</button></div>
            <FolderTree folders={articleFolders} current={folder} onSelect={setFolder}/>
          </nav>
          <section className="admin-catalog-content" aria-label="文章列表">
            <div className="admin-filters">
              <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索文章标题…" aria-label="搜索文章"/>
              <select value={status} onChange={e=>setStatus(e.target.value)} aria-label="发布状态"><option value="all">全部状态</option><option value="published">已发布</option><option value="draft">草稿</option></select>
              <button className="button secondary" aria-label="重建索引" onClick={()=>run(async()=>{const r=await api('admin/reindex',{});await refresh();toast('已重建 '+r.count+' 篇文章的索引');})} title="本地修改文件后，重新扫描内容"><RotateCcw size={14}/></button>
              <a className="button secondary" href="/api/admin/export" aria-label="导出 Markdown 与附件" title="导出 Markdown 与附件"><Download size={14}/></a>
            </div>
            <div className="admin-article-list">{articles.map(a=><article className="admin-article-card" key={a.id} data-article-id={a.id}>
              <div className="admin-card-content"><div className="admin-card-heading"><h2><button className="article-title-button" onClick={()=>switchDocument(a)}>{a.title}</button></h2><div className="admin-card-status">
                <span className={'status-label '+a.status}>{a.status==='published'?(state.gitEnabled?'发布':'已发布'):'草稿'}</span>
                {state.editorDrafts?.some(draft=>draft.articleId===a.id)&&<span className="status-label pending-draft">{state.gitEnabled?'有未发布编辑稿':'有未推送修改'}</span>}
              </div></div>
              {a.summary&&<p className="admin-card-summary">{a.summary}</p>}
              <div className="admin-card-meta">
                <span><FolderClosed size={13}/>{state.folders.find(f=>f.id===a.folderId)?.name||'根目录'}</span>
                <span className="privacy-label">{a.access==='password'?<LockKeyhole size={12}/>:a.access==='private'?<Shield size={12}/>:<Globe size={12}/>} {accessNames[a.access||'inherit']}</span>
                <span>更新于 <time dateTime={a.updatedAt}>{dateText(a.updatedAt)}</time></span>
              </div></div>
              <div className="admin-card-actions">
                <button className="text-button" onClick={()=>switchDocument(a)} aria-label={'编辑 '+a.title}><Pencil size={14}/>编辑</button>
                <Link className="text-button" href={state.gitEnabled?'/admin/preview/'+a.id:'/posts/'+a.id} target="_blank" aria-label={'预览 '+a.title}><ArrowUpRight size={15}/>预览</Link>
                <button className="text-button" onClick={()=>{if(window.confirm('将「'+a.title+'」移入回收站？'))run(async()=>{await api('admin/trash',{id:a.id,kind:'article'});await refresh();toast('已移入回收站');});}} aria-label={'删除 '+a.title}><Trash2 size={14}/>删除</button>
              </div>
            </article>)}</div>
            {!articles.length&&<div className="empty-state"><FileText size={30}/><h3>{query||status!=='all'?'没有符合条件的文章':'在这里，写下新的记录。'}</h3><p>创建一篇文章，或在设置中从 WordPress 导入已有内容。</p><button className="outline-link" onClick={()=>switchDocument(newDocument(folder))}>写文章 <Plus size={14}/></button></div>}
          </section>
        </div>
      </>}
      {section==='pages'&&!doc&&<>
        <div className="admin-page-heading"><h1>页面</h1><div className="admin-actions"><button className="button secondary" onClick={()=>go('trash')}><Trash2 size={15}/>回收站</button><button className="button primary" onClick={()=>switchDocument({...newDocument(state.folders.find(f=>f.path==='独立页面')?.id||'root'),kind:'page',contentFormat:'html',css:'',route:''})}><Plus size={15}/>新建页面</button></div></div>
        <div className="admin-filters"><input aria-label="搜索页面" placeholder="搜索页面标题或地址…" value={query} onChange={event=>setQuery(event.target.value)}/><select aria-label="页面发布状态" value={status} onChange={event=>setStatus(event.target.value)}><option value="all">全部状态</option><option value="published">已发布</option><option value="draft">草稿</option></select></div>
        <div className="admin-article-list">{(state.pages||[]).filter(page=>(status==='all'||page.status===status)&&(page.title+' '+(page.route||'')).toLowerCase().includes(query.toLowerCase())).map(page=><article className="admin-article-card" key={page.id}>
          <div className="admin-card-content"><div className="admin-card-heading"><h2><button className="article-title-button" onClick={()=>switchDocument(page)}>{state.editorDrafts?.find(draft=>draft.articleId===page.id)?.title||page.title}</button></h2><div className="admin-card-status"><span className={'status-label '+page.status}>{page.status==='published'?(state.gitEnabled?'发布':'已发布'):'草稿'}</span>{state.editorDrafts?.some(draft=>draft.articleId===page.id)&&<span className="status-label pending-draft">{state.gitEnabled?'有未发布编辑稿':'有未推送修改'}</span>}</div></div>
          {page.summary&&<p className="admin-card-summary">{page.summary}</p>}
          <div className="admin-card-meta"><code>{page.route||page.aliases[0]||'/posts/'+page.id}</code><span>HTML + CSS</span><span>{accessNames[page.access||'inherit']}</span><span>更新于 <time dateTime={page.updatedAt}>{dateText(page.updatedAt)}</time></span></div></div>
          <div className="admin-card-actions"><button className="text-button" onClick={()=>switchDocument(page)}><Pencil size={14}/>编辑</button><Link className="text-button" href={state.gitEnabled?'/admin/preview/'+page.id:page.status==='published'&&page.route?page.route:'/posts/'+page.id} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={15}/>打开</Link><button className="text-button" onClick={()=>{if(window.confirm('将「'+page.title+'」移入回收站？'))run(async()=>{await api('admin/trash',{id:page.id,kind:'article'});await refresh();toast('页面已移入回收站');});}}><Trash2 size={14}/>删除</button></div>
        </article>)}</div>
        {!(state.pages||[]).length&&<div className="empty-state"><h3>暂无页面</h3><p>新建页面后，直接编辑 HTML 与 CSS。</p></div>}
      </>}
      {doc&&<>
        <WritingMenu onExit={()=>switchDocument(null)} entity={doc.kind==='page'?'页面':'文章'} open={menuOpen} onOpenChange={open=>{if(open)writing.current?.closePanels();setMenuOpen(open);}} status={saveText} statusKind={saveStatus.phase==='error'?'error':saveStatus.phase==='saving'?'saving':dirty?'dirty':'saved'}>
          <div className={'writing-draft-status'+(saveStatus.phase==='error'?' error':'')} role="status"><strong>{saveText}</strong><span title={doc.status==='published'?'保存编辑稿不会更新前台':'草稿仅管理员可见'}>{state.gitEnabled?(doc.status==='published'?'目标状态：发布 · 推送同步后生效':'目标状态：草稿 · 访客不可见'):doc.status==='published'?'已发布':'草稿 · 尚未发布'}</span>{saveStatus.savedAt&&<time dateTime={saveStatus.savedAt}>上次保存 {new Date(saveStatus.savedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time>}</div>
          <div className="writing-action-group"><div className="writing-menu-actions">
            <button className="button primary writing-publish" disabled={busy||saveStatus.blocked} onClick={()=>run(async()=>{await save('published');})}>{state.gitEnabled?(doc.status==='published'?'准备更新':'准备发布'):doc.status==='published'?'推送修改':doc.kind==='page'?'发布页面':'发布文章'}<ArrowRight size={15}/></button>
            {state.gitEnabled&&<button className="button secondary" disabled={busy||saveStatus.blocked} onClick={()=>run(async()=>{await save();setSection('commits');editing.current=null;setDoc(null);setDirty(false);setMenuOpen(false);})}>查看提交</button>}
            <button className="button secondary" disabled={busy||saveStatus.blocked} onClick={()=>run(async()=>{await save();})}><Save size={15}/>保存</button>
            {doc.version?<Link className="button secondary" href={state.gitEnabled?'/admin/preview/'+doc.id:doc.kind==='page'&&doc.status==='published'&&doc.route?doc.route:'/posts/'+doc.id} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={15}/>工作区预览</Link>:<button className="button secondary" disabled title="保存后可打开"><ArrowUpRight size={15}/>打开</button>}
            <button className="button secondary" disabled={!fullscreenAvailable} onClick={()=>run(async()=>{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();})}>{fullscreen?<Minimize2 size={15}/>:<Maximize2 size={15}/>} {fullscreen?'退出全屏':'全屏'}</button>
          </div><label className="writing-summary">{doc.kind==='page'?'页面摘要':'文章摘要'}<textarea rows={3} value={doc.summary||''} onChange={event=>change({summary:event.target.value})}/></label></div>
          {doc.status==='published'&&<button className="text-button writing-unpublish" disabled={busy||saveStatus.blocked} onClick={()=>run(async()=>{await save('draft');})}>{state.gitEnabled?'准备撤回为草稿':'撤回为草稿'}</button>}
          {doc.kind!=='page'&&<div className="writing-mobile-tools"><div className="writing-view-modes" role="group" aria-label="编辑模式">{([['visual','可视化'],['code','源码'],['preview','预览']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={mode===value} className={mode===value?'active':''} onClick={()=>{setMode(value);setMenuOpen(false);}}>{label}</button>)}</div><button className="button secondary" disabled={!blockAvailable||mode==='preview'} onClick={()=>{setMenuOpen(false);setTimeout(()=>writing.current?.openBlockSettings(),0);}}><PanelRight size={15}/>区块设置</button></div>}
          <h3 className="writing-menu-section-title">{doc.kind==='page'?'页面设置':'文章设置'}</h3><ArticleSettings doc={doc} folders={articleFolders} onChange={change}/>
        </WritingMenu>
        <section className="writing-desk" aria-label={doc.kind==='page'?'页面编辑':'文章编辑'}>
          <div className={'writing-column'+(doc.kind==='page'?' page-writing-column':'')}>{doc.kind==='page'?<PageEditor key={editorSession} ref={pageWriting} doc={doc as PageDocument} onChange={change} onUpload={upload} onChooseMedia={chooseImage} preview={preview} previewCss={previewCss} previewClass={previewClass} previewError={previewError}/>:<WritingEditor key={editorSession} ref={writing} doc={doc} dirty={dirty} mode={mode} onModeChange={setMode} preview={preview} onChange={change} onUpload={upload} onChooseMedia={chooseImage} onBlockAvailabilityChange={setBlockAvailable} onError={message=>toast(message,true)}/>}</div>
        </section>
      </>}
      {section==='trash'&&<>
        <button className="text-button admin-tool-back" onClick={()=>go('articles')}><ChevronLeft size={15}/>返回文章管理</button>
        <div className="admin-page-heading"><h1>回收站</h1><span className="count-badge">{state.trash.length} 项</span></div>
        <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>内容</th><th>移除日期</th><th>操作</th></tr></thead><tbody>{state.trash.map(t=><tr key={t.id}><td>{t.title}<small>{t.kind==='folder'?'文件夹':'文章'} · {t.originalPath}</small></td><td>{dateText(t.time)}</td><td><button className="text-button" onClick={()=>run(async()=>{await api('admin/restore',{id:t.id});await refresh();toast('已恢复到原位置');})}><RotateCcw size={13}/>恢复</button></td></tr>)}</tbody></table></div>
        {!state.trash.length&&<div className="empty-state"><Trash2 size={27}/><h3>回收站是空的。</h3></div>}
      </>}
      {section==='settings'&&<SettingsPanel settings={settingsDraft} folders={state.folders} busy={busy} onChange={setSettingsDraft} onImport={()=>go('import')} onSave={settings=>run(async()=>{await api('admin/settings',settings);const next=await refresh();setSettingsDraft(next.settings);toast('站点设置已保存');})}/>}
      {section==='import'&&<><button className="text-button admin-tool-back" onClick={()=>go('settings')}><ChevronLeft size={15}/>返回站点设置</button><ImportPanel onDone={async()=>{await refresh();}} toast={toast}/></>}
    </main></div>
    {imagePicker&&<ImagePicker onClose={()=>setImagePicker(false)} onSelect={insertMedia} onUpload={upload}/>}
    <dialog className="unsaved-dialog" aria-labelledby="unsaved-title" ref={leaveDialog} onCancel={()=>{pendingLeave.current=null;}}>
      <h2 id="unsaved-title">有未保存的修改</h2><p>离开后，当前修改将不会保存。</p>
      <div className="admin-actions"><button type="button" className="button secondary" autoFocus onClick={cancelLeave}>继续编辑</button><button type="button" className="button primary" onClick={discardAndLeave}>不保存并离开</button></div>
    </dialog>
    <dialog className="folder-modal" ref={folderDialog}>
      <div className="modal-heading"><h2>{folderEdit.id?'编辑文件夹':'新建文件夹'}</h2><button className="icon-button" onClick={()=>folderDialog.current?.close()} aria-label="关闭"><X size={18}/></button></div>
      <form onSubmit={e=>{e.preventDefault();run(async()=>{await api('admin/folders',folderEdit);await refresh();folderDialog.current?.close();toast('文件夹已保存');});}}>
        <label>文件夹名称<input autoFocus required value={folderEdit.name||''} onChange={e=>setFolderEdit(f=>({...f,name:e.target.value}))}/></label>
        <label>上级目录<select value={folderEdit.parentId||'root'} onChange={e=>setFolderEdit(f=>({...f,parentId:e.target.value}))}>{state.folders.filter(f=>f.id!==folderEdit.id&&(!folderEdit.path||!f.path.startsWith(folderEdit.path+'/'))).map(f=><option key={f.id} value={f.id}>{f.path||'根目录'}</option>)}</select></label>
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

function SettingsPanel({settings:value,folders,busy,onSave,onChange,onImport}:{settings:SiteSettings;folders:ClientFolder[];busy:boolean;onSave:(s:SiteSettings)=>void;onChange:(s:SiteSettings)=>void;onImport:()=>void}){
 const set=(patch:Partial<SiteSettings>)=>onChange({...value,...patch});return <form onSubmit={e=>{e.preventDefault();onSave(value);}}><div className="admin-page-heading"><div><h1>站点设置</h1></div><div className="admin-actions"><button className="button secondary" type="button" onClick={onImport}><Upload size={14}/>WordPress 导入</button><button className="button primary" disabled={busy}><Save size={14}/>保存设置</button></div></div><div className="settings-grid"><h2 className="settings-section-title settings-wide">基本信息</h2>{([['title','站点名称'],['subtitle','站点副标题'],['email','联系邮箱'],['logo','Logo 地址'],['description','站点简介'],['footer','备案号']] as const).map(([k,label])=><label className="settings-field" key={k}>{label}<input value={value[k]} onChange={e=>set({[k]:e.target.value})}/></label>)}<label className="settings-field settings-wide">前台目录根文件夹<select value={value.knowledgeRootId||folders.find(f=>f.path==='博客')?.id||''} onChange={e=>set({knowledgeRootId:e.target.value})}><option value="">未选择</option>{folders.filter(f=>f.id!=='root').map(f=><option key={f.id} value={f.id}>{f.path}</option>)}</select></label><h2 className="settings-section-title settings-wide">导航</h2><div className="settings-wide">{value.navigation.map((n,i)=><div className="setting-nav-row" key={i}><input aria-label="导航标题" value={n.label} onChange={e=>set({navigation:value.navigation.map((x,j)=>i===j?{...x,label:e.target.value}:x)})}/><input aria-label="导航链接" value={n.href} onChange={e=>set({navigation:value.navigation.map((x,j)=>i===j?{...x,href:e.target.value}:x)})}/><button type="button" onClick={()=>set({navigation:value.navigation.filter((_,j)=>j!==i)})} aria-label="删除导航"><X size={16}/></button></div>)}<button className="text-button" type="button" onClick={()=>set({navigation:[...value.navigation,{label:'新链接',href:'/knowledge'}]})}><Plus size={14}/>添加导航</button></div><h2 className="settings-section-title settings-wide">首页内容</h2><div className="settings-box settings-wide"><p style={{marginTop:0,marginBottom:12}}>选择首页展示的文件夹；不选择时显示所有已发布博客文章，独立页面不进入文章列表。</p>{folders.filter(f=>f.id!=='root').map(f=><label key={f.id}><input type="checkbox" checked={value.homeFolders.includes(f.id)} onChange={e=>set({homeFolders:e.target.checked?[...value.homeFolders,f.id]:value.homeFolders.filter(id=>id!==f.id)})}/>{f.path}</label>)}</div><h2 className="settings-section-title settings-wide">Giscus 评论</h2><div className="settings-box settings-wide"><label><input type="checkbox" checked={value.giscus.enabled} onChange={e=>set({giscus:{...value.giscus,enabled:e.target.checked}})}/>公开文章启用评论</label><p>密码和私密文章始终关闭评论。Giscus 评论存储在公开的 GitHub Discussions。</p></div>{([['repo','仓库（owner/repo）'],['repoId','仓库 ID'],['category','Discussion 分类'],['categoryId','分类 ID']] as const).map(([k,label])=><label className="settings-field" key={k}>{label}<input value={value.giscus[k]} onChange={e=>set({giscus:{...value.giscus,[k]:e.target.value}})}/></label>)}</div></form>;
}

function ImportPanel({onDone,toast}:{onDone:()=>Promise<void>;toast:(message:string,error?:boolean)=>void}){
 const[analysis,setAnalysis]=useState<(ImportAnalysis&{id:string})|null>(null);const[choices,setChoices]=useState<ImportChoice[]>([]);const[busy,setBusy]=useState(false);const[rootFolder,setRootFolder]=useState('');const[preview,setPreview]=useState<{title:string;html:string}|null>(null);const[result,setResult]=useState<{imported:number;updated:number;skipped:number;trashed:number;warnings:{message:string;title:string}[]}|null>(null);
 function apply(data:ImportAnalysis&{id:string}){setAnalysis(data);setChoices(data.candidates.map(c=>({id:c.meta.id,selected:!c.duplicate,folder:c.folder,update:false})));setResult(null);setPreview(null);}
 async function upload(form:FormData){setBusy(true);try{const response=await fetch('/api/admin/imports',{method:'POST',body:form});const data=await response.json();if(!response.ok)throw new Error(data.error);apply(data);toast(`已分析 ${data.candidates.length} 篇文章与页面，尚未写入内容目录`);}catch(e){toast((e as Error).message,true);}finally{setBusy(false);}}
 function choose(id:string,patch:Partial<ImportChoice>){setChoices(rows=>rows.map(c=>c.id===id?{...c,...patch}:c));}
 return <><div className="admin-page-heading"><div><h1>WordPress 导入</h1></div>{analysis&&<button className="button secondary" onClick={()=>{setAnalysis(null);setResult(null);}}>重新上传</button>}</div><div className="import-steps"><span className={!analysis?'active':''}><b>1</b>上传文件</span><ArrowRight size={11}/><span className={analysis&&!result?'active':''}><b>2</b>转换与预览</span><ArrowRight size={11}/><span className={result?'active':''}><b>3</b>确认导入</span></div>{!analysis?<div className="import-upload"><Upload size={27} style={{marginBottom:15,color:'var(--muted)'}}/><p>上传 WordPress WXR XML，自动转换为 Markdown 与样式块。转换预览不会写入正式内容。</p><form onSubmit={e=>{e.preventDefault();upload(new FormData(e.currentTarget));}}><label>WordPress 导出文件（XML，最大 50MB）<input type="file" name="xml" accept=".xml" required/></label><label>媒体包（可选，uploads ZIP，最大 256MB）<input type="file" name="media" accept=".zip"/></label><p className="small muted">没有媒体包时保留远程图片链接，并在报告中列出。原始密码会转换为加盐哈希。</p><button className="button primary" disabled={busy}>{busy?<LoaderCircle size={14} className="spin"/>:<Upload size={14}/>} {busy?'正在分析…':'分析并预览'}</button></form></div>:<>{result?<><div className="admin-notice"><span>导入完成：新增 {result.imported}，更新 {result.updated}，跳过 {result.skipped}，回收站 {result.trashed}。</span><Check size={16}/></div>{result.warnings.length>0&&<details className="import-warning-list" open><summary>{result.warnings.length} 条媒体处理提示</summary><ul>{result.warnings.map((w,i)=><li key={i}>{w.title}：{w.message}</li>)}</ul></details>}</>:null}<div className="import-profile"><span>来源：{analysis.title}</span><label>样式配置 <select value={analysis.profileId} disabled={busy} onChange={async e=>{setBusy(true);try{apply(await api(`admin/imports/${analysis.id}/profile`,{profileId:e.target.value}));}catch(err){toast((err as Error).message,true);}finally{setBusy(false);}}}>{analysis.profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><a href={`/api/admin/imports/${analysis.id}/download`} className="text-button"><Download size={13}/>下载转换结果</a></div><label className="settings-field" style={{maxWidth:420,marginBottom:20}}>导入到根目录下的文件夹（可留空）<input value={rootFolder} onChange={e=>setRootFolder(e.target.value)} placeholder="例如：旧站笔记"/></label><div className="admin-actions" style={{marginBottom:14}}><button className="text-button" onClick={()=>setChoices(c=>c.map(x=>({...x,selected:true})))}>全选</button><button className="text-button" onClick={()=>setChoices(c=>c.map(x=>({...x,selected:false})))}>清空选择</button><span className="muted small">已选 {choices.filter(c=>c.selected).length} / {choices.length}</span></div><div className="import-choices"><table className="admin-table"><thead><tr><th>选择</th><th>文章</th><th>目标目录</th><th>处理</th></tr></thead><tbody>{analysis.candidates.map(c=>{const choice=choices.find(x=>x.id===c.meta.id)!;return <tr key={c.meta.id}><td><input type="checkbox" checked={choice.selected} onChange={e=>choose(c.meta.id,{selected:e.target.checked})} aria-label={`导入 ${c.meta.title}`}/></td><td><button className="article-title-button" style={{fontSize:13}} onClick={async()=>{setBusy(true);try{const rendered=await api('admin/preview',{body:c.body});setPreview({title:c.meta.title,html:rendered.html});}catch(err){toast((err as Error).message,true);}finally{setBusy(false);}}}>{c.meta.title}</button><small>{c.trash?'回收站':c.meta.status==='published'?'已发布':'草稿'} · {accessNames[c.meta.access]} · {c.warnings.length} 条提示</small></td><td><input list={`folders-${c.meta.id}`} value={choice.folder||''} onChange={e=>choose(c.meta.id,{folder:e.target.value})} aria-label={`${c.meta.title} 的目标目录`}/><datalist id={`folders-${c.meta.id}`}>{c.folderOptions.map(f=><option key={f} value={f}/>)}</datalist></td><td>{c.inTrash?<span className="small muted">回收站中，先恢复后更新</span>:c.duplicate?<label className="small"><input type="checkbox" checked={choice.update||false} onChange={e=>choose(c.meta.id,{update:e.target.checked})}/> 更新已有</label>:<span className="small muted">新增</span>}</td></tr>;})}</tbody></table></div>{preview&&<div className="import-preview"><div className="import-preview-heading"><strong>{preview.title}</strong><button className="icon-button" onClick={()=>setPreview(null)} aria-label="关闭预览"><X size={16}/></button></div><MarkdownBody html={preview.html}/></div>}<details className="import-warning-list"><summary>{analysis.warnings.length} 条转换提示 · 查看报告</summary><ul>{analysis.warnings.map((w,i)=><li key={i}>{w.title} / {w.block}：{w.message}</li>)}</ul></details><div className="admin-actions" style={{marginTop:25}}><button className="button primary" disabled={busy||!choices.some(c=>c.selected)} onClick={async()=>{if(!window.confirm(`将选中的 ${choices.filter(c=>c.selected).length} 项写入内容目录？原发布状态和密码保护将被保留。`))return;setBusy(true);try{setResult(await api(`admin/imports/${analysis.id}/commit`,{choices,rootFolder}));await onDone();toast('导入完成，可在文章管理中查看');}catch(e){toast((e as Error).message,true);}finally{setBusy(false);}}}>{busy?<LoaderCircle size={14}/>:<Check size={14}/>}确认导入所选内容</button><p className="small muted">原 XML 和媒体备份保持不变。</p></div></>}</>;
}

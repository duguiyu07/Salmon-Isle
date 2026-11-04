'use client';
import {forwardRef,useEffect,useId,useImperativeHandle,useRef,useState} from 'react';
import type {Ref,ComponentPropsWithoutRef} from 'react';
import {FolderOptions} from './folder-options';
import {ImagePlus,Layers,Newspaper,FolderTree,Library,Link as LinkIcon} from 'lucide-react';
import type {EditorView} from '@codemirror/view';
import type {PageDocument} from '@/lib/editor-draft-model';
import type {Folder} from '@/lib/model';
import {shortcutHref} from '@/lib/styles';
import {CodeEditor} from './code-editor';
import {MarkdownBody} from './reader';

export type PageEditorMode='html'|'css'|'preview';
export interface PageEditorHandle {insert:(html:string)=>void;rememberSelection:()=>void}
const escape=(text:string)=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export const PageEditor=forwardRef<PageEditorHandle,{doc:PageDocument;folders?:Folder[];onChange:(patch:Partial<PageDocument>)=>void;onUpload:(file:File)=>void;onChooseMedia?:()=>void;preview:string;previewCss:string;previewClass:string;previewError:string;onModeChange?:(mode:PageEditorMode)=>void}>(function PageEditor({doc,folders=[],onChange,onUpload,onChooseMedia,preview,previewCss,previewClass,previewError,onModeChange},ref){
  const html=useRef<EditorView|null>(null),css=useRef<EditorView|null>(null),bookmark=useRef<{from:number;to:number}|null>(null);
  const [mode,setMode]=useState<PageEditorMode>('html'),[menu,setMenu]=useState(false),[configure,setConfigure]=useState<'collection'|'link'|null>(null),[error,setError]=useState('');
  const tools=useRef<HTMLDivElement>(null),dialog=useRef<HTMLDialogElement>(null),id=useId();
  function rememberSelection(){const selection=html.current?.state.selection.main;if(selection)bookmark.current={from:selection.from,to:selection.to};}
  function insert(text:string){const view=html.current;if(!view)return;const selection=bookmark.current||view.state.selection.main;bookmark.current=null;view.dispatch({changes:{from:selection.from,to:selection.to,insert:text},selection:{anchor:selection.from+text.length}});setMode('html');setMenu(false);requestAnimationFrame(()=>{view.requestMeasure();view.focus();});}
  useImperativeHandle(ref,()=>({insert,rememberSelection}));
  useEffect(()=>{const view=mode==='html'?html.current:mode==='css'?css.current:null;view?.requestMeasure();},[mode]);
  useEffect(()=>{if(configure)dialog.current?.showModal();},[configure]);
  useEffect(()=>{if(!menu)return;const close=(event:PointerEvent)=>{if(!tools.current?.contains(event.target as Node))setMenu(false);};const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setMenu(false);};document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);};},[menu]);
  useEffect(()=>{onModeChange?.(mode);},[mode,onModeChange]);
  return <>
    <input className="editor-title" placeholder="页面标题" aria-label="页面标题" value={doc.title} onChange={event=>onChange({title:event.target.value})}/>
    <div className="editor-sticky-tools writing-toolbar page-toolbar" ref={tools} role="toolbar" aria-label="页面工具">
      <div className="page-format-actions">
        {onChooseMedia&&<button type="button" aria-label="插入图片" title="插入图片" onClick={()=>{rememberSelection();onChooseMedia();}}><ImagePlus size={16}/></button>}
        <div className="page-insert-menu"><button type="button" aria-label="插入动态内容" title="插入动态内容" aria-haspopup="menu" aria-expanded={menu} onClick={()=>{rememberSelection();setMenu(!menu);}}><Layers size={16}/><span>插入动态内容</span></button>
          {menu&&<div role="menu" aria-label="动态内容" onKeyDown={event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button')),index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowUp'?buttons.length-1:1))%buttons.length]?.focus();}}>
            <button type="button" role="menuitem" onClick={()=>insert('\n<div data-page-slot="home-posts"></div>\n')}><Newspaper size={16}/>首页文章列表</button>
            <button type="button" role="menuitem" onClick={()=>insert('\n<div data-page-slot="archive"></div>\n')}><FolderTree size={16}/>归档目录</button>
            <button type="button" role="menuitem" onClick={()=>{setMenu(false);setError('');setConfigure('collection');}}><Library size={16}/>文章集合</button>
            <button type="button" role="menuitem" onClick={()=>{setMenu(false);setError('');setConfigure('link');}}><LinkIcon size={16}/>链接卡片</button>
          </div>}
        </div>
      </div>
      <div className="writing-view-modes page-view-modes" role="tablist" aria-label="页面编辑模式" onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const modes:PageEditorMode[]=['html','css','preview'],index=modes.indexOf(mode),next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;setMode(modes[next]);event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();}}>{([['html','HTML'],['css','CSS'],['preview','预览']] as const).map(([value,label])=><button type="button" key={value} id={`${id}-${value}-tab`} role="tab" aria-selected={mode===value} aria-controls={`${id}-${value}`} tabIndex={mode===value?0:-1} className={mode===value?'active':''} onClick={()=>setMode(value)}>{label}</button>)}</div>
    </div>
    <section id={`${id}-html`} role="tabpanel" aria-labelledby={`${id}-html-tab`} hidden={mode!=='html'} className="page-code-panel"><CodeEditor language="html" label="页面 HTML 源码" value={doc.body} onChange={body=>onChange({body})} onCursor={()=>{}} onPaste={file=>{rememberSelection();onUpload(file);}} editorRef={html} onUpdate={update=>{if(update.docChanged&&bookmark.current)bookmark.current={from:update.changes.mapPos(bookmark.current.from),to:update.changes.mapPos(bookmark.current.to)};}}/></section>
    <section id={`${id}-css`} role="tabpanel" aria-labelledby={`${id}-css-tab`} hidden={mode!=='css'} className="page-code-panel"><CodeEditor language="css" label="页面 CSS 源码" value={doc.css||''} onChange={css=>onChange({css})} onCursor={()=>{}} onPaste={()=>{}} editorRef={css}/></section>
    <section id={`${id}-preview`} role="tabpanel" aria-labelledby={`${id}-preview-tab`} hidden={mode!=='preview'} className="page-preview-panel">{previewError&&<p className="form-error" role="status">预览暂不可用：{previewError}。源码会继续保留。</p>}<div className={`managed-page ${previewClass}`} data-page-id={doc.id}><style>{previewCss}</style><MarkdownBody html={preview} className={['/','/knowledge'].includes(doc.route||'')?'page-html-body':'markdown-body'}/></div></section>
    <dialog ref={dialog} className="page-insert-dialog" onClose={()=>setConfigure(null)}><form key={configure} onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);if(configure==='collection')insert(`\n<div data-page-slot="collection" data-folder-id="${escape(String(form.get('folder')))}" data-per-page="${Math.min(50,Math.max(1,Number(form.get('perPage'))||10))}"></div>\n`);else{const href=shortcutHref(String(form.get('href')));if(!href){setError('请输入有效的网址或站内地址');return;}insert(`\n<a class="page-link-card shortcut-card" href="${escape(href)}"><strong>${escape(String(form.get('title')))}</strong>${form.get('description')?`<span>${escape(String(form.get('description')))}</span>`:''}</a>\n`);}dialog.current?.close();}}>
      <h2>{configure==='collection'?'插入文章集合':'插入链接卡片'}</h2>
      {configure==='collection'?<><label>集合文件夹<select name="folder" defaultValue={doc.collection?.folderId||'root'}><FolderOptions folders={folders}/></select></label><label>每页篇数<input name="perPage" type="number" min="1" max="50" defaultValue={doc.collection?.perPage||10} required/></label></>:<><label>标题<input name="title" required/></label><label>说明<input name="description"/></label><label>链接地址<input name="href" placeholder="https:// 或 /about" required/></label></>}
      {error&&<p className="form-error" role="alert">{error}</p>}<div className="admin-actions"><button type="button" className="button secondary" onClick={()=>dialog.current?.close()}>取消</button><button className="button primary">插入</button></div>
    </form></dialog>
  </>;
});

export function LazyPageEditor({editorRef,...props}:ComponentPropsWithoutRef<typeof PageEditor>&{editorRef:Ref<PageEditorHandle>}){return <PageEditor ref={editorRef} {...props}/>;}

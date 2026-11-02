'use client';
import {forwardRef,useImperativeHandle,useRef} from 'react';
import type {EditorView} from '@codemirror/view';
import type {PageDocument} from '@/lib/editor-draft-model';
import {CodeEditor} from './code-editor';
import {MarkdownBody} from './reader';

export interface PageEditorHandle {insert:(html:string)=>void}
export const PageEditor=forwardRef<PageEditorHandle,{doc:PageDocument;onChange:(patch:Partial<PageDocument>)=>void;onUpload:(file:File)=>void;onChooseMedia?:()=>void;preview:string;previewCss:string;previewClass:string;previewError:string}>(function PageEditor({doc,onChange,onUpload,onChooseMedia,preview,previewCss,previewClass,previewError},ref){
  const html=useRef<EditorView|null>(null),css=useRef<EditorView|null>(null);
  const insert=(text:string)=>{const view=html.current;if(!view)return;const selection=view.state.selection.main;view.dispatch({changes:{from:selection.from,to:selection.to,insert:text},selection:{anchor:selection.from+text.length}});view.focus();};
  useImperativeHandle(ref,()=>({insert}));
  return <>
    {onChooseMedia&&<button type="button" className="button secondary" onClick={onChooseMedia}>插入图片</button>}
    <input className="editor-title" placeholder="页面标题" aria-label="页面标题" value={doc.title} onChange={event=>onChange({title:event.target.value})}/>
    <label className="page-route-field">页面地址<input aria-label="页面地址" placeholder="/example" value={doc.route||''} onChange={event=>onChange({route:event.target.value})}/></label>
    <div className="page-source-grid"><section><h2>HTML</h2><CodeEditor language="html" label="页面 HTML 源码" value={doc.body} onChange={body=>onChange({body})} onCursor={()=>{}} onPaste={onUpload} editorRef={html}/></section>
      <section><h2>CSS</h2><CodeEditor language="css" label="页面 CSS 源码" value={doc.css||''} onChange={css=>onChange({css})} onCursor={()=>{}} onPaste={()=>{}} editorRef={css}/></section></div>
    <div className="page-slot-tools" role="group" aria-label="插入动态内容"><span>插入动态内容</span>{([['home-posts','首页文章列表'],['archive','归档目录'],['collection','文章集合']] as const).map(([slot,label])=><button className="button secondary" type="button" key={slot} onClick={()=>insert(`\n<div data-page-slot="${slot}"></div>\n`)}>{label}</button>)}</div>
    <section className="page-editor-preview"><h2>效果预览</h2>{previewError&&<p className="form-error" role="status">预览暂不可用：{previewError}。源码会继续保留。</p>}
      <div className={`managed-page ${previewClass}`} data-page-id={doc.id}><style>{previewCss}</style><MarkdownBody html={preview} className={['/','/knowledge'].includes(doc.route||'')?'page-html-body':'markdown-body'}/></div>
    </section>
  </>;
});

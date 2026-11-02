'use client';
import { useEffect,useRef } from 'react';
import { EditorView,type ViewUpdate } from '@codemirror/view';
import { EditorState,Prec,Transaction } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import {html} from '@codemirror/lang-html';
import {css} from '@codemirror/lang-css';
import {sourceInsertionLine} from '@/lib/editor-block';
import type {EditorAnchor} from '@/lib/editor-ui';
import {inlineEdit} from '@/lib/live-markdown';
export function CodeEditor({value,onChange,onCursor,onPaste,editorRef,onBlankLine,onUpdate,language='markdown',label='Markdown 源码编辑器'}:{value:string;onChange:(value:string)=>void;onCursor:(line:number)=>void;onPaste:(file:File)=>void;editorRef:React.RefObject<EditorView|null>;onBlankLine?:(anchor:EditorAnchor|null)=>void;onUpdate?:(update:ViewUpdate)=>void;language?:'markdown'|'html'|'css';label?:string}){
  const host=useRef<HTMLDivElement>(null);const syncing=useRef(false);const callbacks=useRef({onChange,onCursor,onPaste,onBlankLine,onUpdate});callbacks.current={onChange,onCursor,onPaste,onBlankLine,onUpdate};
  useEffect(()=>{if(!host.current)return;
    let frame=0;
    const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const selection=view.state.selection.main,line=view.state.doc.lineAt(selection.head);callbacks.current.onCursor(line.number);if(view.hasFocus&&selection.empty&&sourceInsertionLine(view.state.doc.toString(),line.number)){const coords=view.coordsAtPos(selection.head),rect=view.contentDOM.getBoundingClientRect();callbacks.current.onBlankLine?.(coords?{top:coords.top,bottom:coords.bottom,left:rect.left,right:rect.right}:null);}else callbacks.current.onBlankLine?.(null);});};
    const view=new EditorView({parent:host.current,state:EditorState.create({doc:value,extensions:[basicSetup,language==='html'?html():language==='css'?css():markdown(),EditorView.contentAttributes.of({'aria-label':label}),EditorView.lineWrapping,EditorView.updateListener.of(update=>{callbacks.current.onUpdate?.(update);if(update.docChanged&&!syncing.current)callbacks.current.onChange(update.state.doc.toString());if(update.selectionSet||update.docChanged||update.focusChanged||update.geometryChanged)measure();}),Prec.highest(EditorView.domEventHandlers({keydown(event,view){if(language!=='markdown'||event.isComposing||!(event.ctrlKey||event.metaKey)||event.altKey)return false;const format=event.key.toLowerCase()==='e'?'inlineCode':event.shiftKey&&event.key.toLowerCase()==='m'?'inlineMath':null;if(!format)return false;event.preventDefault();const selection=view.state.selection.main,edit=inlineEdit(view.state.doc.toString(),selection.from,selection.to,format);if(edit)view.dispatch({changes:{from:edit.from,to:edit.to,insert:edit.insert},selection:{anchor:edit.anchor,head:edit.head},scrollIntoView:true});return true;},paste(event){const file=Array.from(event.clipboardData?.files||[]).find(f=>f.type.startsWith('image/'));if(file){event.preventDefault();callbacks.current.onPaste(file);return true;}return false;}}))]})});editorRef.current=view;window.addEventListener('scroll',measure,true);window.addEventListener('resize',measure);return()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',measure,true);window.removeEventListener('resize',measure);view.destroy();editorRef.current=null;};
  // The editor's lifetime is separate from document updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{const view=editorRef.current;if(view&&view.state.doc.toString()!==value){syncing.current=true;try{view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value},annotations:Transaction.addToHistory.of(false)});}finally{syncing.current=false;}}},[value,editorRef]);
  return <div className="codemirror-container" ref={host}/>;
}

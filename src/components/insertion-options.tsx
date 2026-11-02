'use client';
import {Layers,ChevronDown,PanelsTopLeft,Columns2,Images,SquareCode,CodeXml,Sigma,Table2,ListTodo,Quote,ImagePlus} from 'lucide-react';
import {editorInsertions} from '@/lib/editor-insertions';
const icons={group:Layers,details:ChevronDown,tabs:PanelsTopLeft,columns:Columns2,gallery:Images,code:SquareCode,html:CodeXml,math:Sigma,table:Table2,task:ListTodo,quote:Quote};
export function InsertionOptions({onInsert,onUpload,onUploadStart,onChooseMedia}:{onInsert:(markdown:string)=>void;onUpload?:(file:File)=>void;onUploadStart?:()=>void;onChooseMedia?:()=>void}){
  return <div className="writing-insert-options" role="menu" aria-label="插入区块">{editorInsertions.map(item=>{const Icon=icons[item.key as keyof typeof icons];return <button type="button" role="menuitem" key={item.key} onClick={()=>onInsert(item.markdown)}><Icon size={15}/>{item.label}</button>;})}
    {onChooseMedia?<button type="button" role="menuitem" onClick={()=>{onUploadStart?.();onChooseMedia();}}><ImagePlus size={15}/>插入图片</button>:onUpload&&<label className="insert-upload" role="menuitem" tabIndex={0} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.currentTarget.querySelector('input')?.click();}}}><ImagePlus size={15}/>图片 / 附件<input type="file" aria-label="插入图片或附件" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,.svg,.pdf,.txt,.zip,.mp3,.mp4,.webm" onClick={onUploadStart} onChange={event=>{if(event.target.files?.[0])onUpload(event.target.files[0]);event.target.value='';}}/></label>}
  </div>;
}

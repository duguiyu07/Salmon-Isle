'use client';
import {useId,useMemo} from 'react';
import {importFolderOptions,type SelectableFolder} from '@/lib/folder-options';

export function FolderPathInput({folders,paths=[],value,onChange,label,placeholder}:{folders:SelectableFolder[];paths?:string[];value:string;onChange:(value:string)=>void;label:string;placeholder?:string}){
  const id=useId(),options=useMemo(()=>importFolderOptions(folders,paths),[folders,paths]);
  return <><input list={id} value={value} onChange={event=>onChange(event.target.value)} aria-label={label} placeholder={placeholder}/><datalist id={id}>{options.filter(folder=>folder.path).map(folder=><option key={folder.id} value={folder.path} label={folder.label}/>)}</datalist></>;
}

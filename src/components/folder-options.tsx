import {useMemo} from 'react';
import {folderOptions,type SelectableFolder} from '@/lib/folder-options';

export function FolderOptions({folders,excludeRoot=false}:{folders:SelectableFolder[];excludeRoot?:boolean}){
  const options=useMemo(()=>folderOptions(folders),[folders]);
  return options.filter(folder=>!excludeRoot||folder.id!=='root').map(folder=><option key={folder.id} value={folder.id} title={folder.path||'根目录'}>{folder.label}</option>);
}

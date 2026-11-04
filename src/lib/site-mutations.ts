import {prepareChange,finishChange,recoverChanges} from './direct-library';
import {withRepositoryLock} from './repository-lock';
import {recoverLibraryTransaction} from './library-transaction';
import {getSettings,invalidateLibraryCache,listFolders,reindex} from './storage';
import {workspaceRoot,withWorkspace} from './library-context';
import {validateLibrary} from './library-validation';
import {AppError} from './model';
import path from 'node:path';
import {findArticle} from './storage';
import {safeName} from './paths';

/** File changes are durable together; no network queue or device is involved. */
export async function siteMutation<T>(action:()=>Promise<T>|T,paths?:string[]):Promise<T>{
  return withWorkspace(()=>withRepositoryLock(async()=>{
    recoverLibraryTransaction();recoverChanges();
    const journal=prepareChange(paths);
    try{
      const result=await action();
      if(paths){finishChange(journal.id);return result;}
      invalidateLibraryCache();validateLibrary(workspaceRoot());
      const settings=getSettings(),folders=new Set(listFolders().map(folder=>folder.id));
      if(settings.knowledgeRootId&&!folders.has(settings.knowledgeRootId)||settings.homeFolders.some(id=>!folders.has(id)))
        throw new AppError('网站设置仍引用此文件夹，请先调整设置',409);
      reindex();finishChange(journal.id);return result;
    }catch(error){recoverChanges();invalidateLibraryCache();reindex();throw error;}
  }));
}

/** Autosave journals only the stable article identity and its draft. */
export function draftPaths(id:string,document:{title:string;folderId?:string}){
  const existing=findArticle(id),folder=listFolders().find(folder=>folder.id===(document.folderId||'root'));
  return ['content/'+(existing?.path||path.posix.join(folder?.path||'',safeName(document.title.trim()||'无标题文章')+'--'+id+'.md')),'editor-drafts/'+id+'.json'];
}

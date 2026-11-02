import { getSettings,listArticles,listFolders } from './storage';
import { Folder,Viewer } from './model';
import { folderVisible,publicArticle,visibility } from './access';
export function descendantIds(folders: Pick<Folder,'id'|'parentId'>[],id:string){
  const ids=new Set([id]);let changed=true;
  while(changed){changed=false;for(const f of folders)if(ids.has(f.parentId)&&!ids.has(f.id)){ids.add(f.id);changed=true;}}
  return ids;
}
export function publicData(viewer:Viewer){
  const folders=listFolders();const rootId=getSettings().knowledgeRootId||folders.find(f=>f.path==='博客')?.id;
  const branch=rootId?descendantIds(folders,rootId):new Set<string>();
  const projected=folders.filter(f=>f.id==='root'||(f.id!==rootId&&branch.has(f.id)&&folderVisible(f,folders,viewer)));
  return {folders:projected.map(f=>({id:f.id,name:f.name,parentId:f.parentId===rootId?'root':f.parentId,locked:visibility({id:'folder',title:f.name,access:'inherit',folderId:f.id,status:'published'},folders).gates.length>0})),articles:listArticles().filter(a=>a.kind==='post').map(a=>publicArticle(a,viewer,folders)).filter(a=>a!==null)};
}
/** The archive has its own boundary; other public lists may include MISC. */
export function knowledgeData(viewer:Viewer){
  const allFolders=listFolders();
  const rootId=getSettings().knowledgeRootId||allFolders.find(f=>f.path==='博客')?.id;
  const branch=rootId&&allFolders.some(f=>f.id===rootId)?descendantIds(allFolders,rootId):new Set<string>();
  const data=publicData(viewer);
  return {...data,articles:data.articles.filter(a=>branch.has(a.folderId))};
}
export function folderArticles(folderId:string,viewer:Viewer){
  const folders=listFolders();
  return listArticles().filter(a=>a.kind==='post'&&a.folderId===folderId)
    .toSorted((a,b)=>a.order-b.order||a.title.localeCompare(b.title,'zh-CN',{numeric:true})||a.id.localeCompare(b.id))
    .map(a=>publicArticle(a,viewer,folders)).filter(a=>a!==null);
}

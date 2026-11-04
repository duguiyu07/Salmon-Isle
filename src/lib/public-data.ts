import { getSettings,contentSnapshot,type ContentSnapshot } from './storage';
import { Folder,Viewer } from './model';
import { folderVisible,publicArticle,visibility } from './access';
import {load} from 'cheerio';
export function descendantIds(folders: Pick<Folder,'id'|'parentId'>[],id:string){
  const ids=new Set([id]);let changed=true;
  while(changed){changed=false;for(const f of folders)if(ids.has(f.parentId)&&!ids.has(f.id)){ids.add(f.id);changed=true;}}
  return ids;
}
export function publicData(viewer:Viewer,snapshot:ContentSnapshot=contentSnapshot()){
  const {folders,articles}=snapshot;const rootId=getSettings().knowledgeRootId||folders.find(f=>f.path==='博客')?.id;
  const branch=rootId?descendantIds(folders,rootId):new Set<string>();
  const projected=folders.filter(f=>f.id==='root'||(f.id!==rootId&&branch.has(f.id)&&folderVisible(f,folders,viewer)));
  return {folders:projected.map(f=>({id:f.id,name:f.name,parentId:f.parentId===rootId?'root':f.parentId,locked:visibility({id:'folder',title:f.name,access:'inherit',folderId:f.id,status:'published'},folders).gates.length>0})),articles:articles.filter(a=>a.kind==='post').map(a=>publicArticle(a,viewer,folders)).filter(a=>a!==null)};
}
/** The archive has its own boundary; other public lists may include MISC. */
export function knowledgeData(viewer:Viewer,snapshot:ContentSnapshot=contentSnapshot()){
  const {folders:allFolders,articles:allArticles}=snapshot;
  const misc=allArticles.find(article=>article.kind==='page'&&article.status==='published'&&(article.route==='/misc'||article.aliases.includes('/misc')));
  const roots=new Set<string>();
  if(misc?.collection?.folderId)roots.add(misc.collection.folderId);
  if(misc?.contentFormat==='html'){
    const $=load(misc.body);$('[data-page-slot="collection"][data-folder-id]').each((_,element)=>{roots.add($(element).attr('data-folder-id')!);});
  }
  // Pre-HTML installations may only have the original MISC directory.
  if(!roots.size)for(const folder of allFolders)if(folder.parentId==='root'&&folder.name==='MISC')roots.add(folder.id);
  const excluded=new Set<string>();for(const root of roots)for(const id of descendantIds(allFolders,root))excluded.add(id);
  const articles=allArticles.filter(article=>article.kind==='post'&&!excluded.has(article.folderId)).map(article=>publicArticle(article,viewer,allFolders)).filter(article=>article!==null);
  const pageFolders=new Set(allArticles.filter(article=>article.kind==='page').map(article=>article.folderId));
  const used=new Set(articles.map(article=>article.folderId));
  const folders=allFolders.filter(folder=>!excluded.has(folder.id)&&folderVisible(folder,allFolders,viewer)&&(!pageFolders.has(folder.id)||used.has(folder.id)||folder.id==='root'));
  return {folders:folders.map(folder=>({id:folder.id,name:folder.name,parentId:folders.some(parent=>parent.id===folder.parentId)?folder.parentId:'root',locked:visibility({id:'folder',title:folder.name,access:'inherit',folderId:folder.id,status:'published'},allFolders).gates.length>0})),articles};
}
export function folderArticles(folderId:string,viewer:Viewer,snapshot:ContentSnapshot=contentSnapshot()){
  const {folders,articles}=snapshot;
  return articles.filter(a=>a.kind==='post'&&a.folderId===folderId)
    .toSorted((a,b)=>a.order-b.order||a.title.localeCompare(b.title,'zh-CN',{numeric:true})||a.id.localeCompare(b.id))
    .map(a=>publicArticle(a,viewer,folders)).filter(a=>a!==null);
}

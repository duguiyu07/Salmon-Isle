import type {Folder} from './model';

export type SelectableFolder=Pick<Folder,'id'|'name'|'path'|'parentId'|'order'>;
export interface FolderOption {id:string;path:string;depth:number;label:string}

/** Match the folder tree: sort siblings, then visit each complete branch. */
export function folderOptions(folders:SelectableFolder[]):FolderOption[]{
  const children=new Map<string,SelectableFolder[]>(),ids=new Set(folders.map(folder=>folder.id));
  for(const folder of folders){
    if(folder.id==='root')continue;
    const parent=ids.has(folder.parentId)?folder.parentId:'root';
    const siblings=children.get(parent)||[];siblings.push(folder);children.set(parent,siblings);
  }
  for(const siblings of children.values())siblings.sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name,'zh-CN'));
  const result:FolderOption[]=[],visited=new Set<string>();
  const root=folders.find(folder=>folder.id==='root');
  if(root)result.push({id:root.id,path:'',depth:0,label:'根目录'});
  function visit(parent:string,depth:number){for(const folder of children.get(parent)||[]){
    if(visited.has(folder.id))continue;visited.add(folder.id);
    result.push({id:folder.id,path:folder.path,depth,label:'\u00a0\u00a0'.repeat(depth)+(depth?'└ ':'')+folder.name});
    visit(folder.id,depth+1);
  }}
  visit('root',0);return result;
}

/** Imported paths may not exist yet; preserve existing sibling order first. */
export function importFolderOptions(folders:SelectableFolder[],paths:string[]):FolderOption[]{
  const all=[...folders],byPath=new Map(all.map(folder=>[folder.path,folder]));
  for(const path of paths){let parentId='root',current='';for(const name of path.split('/').filter(Boolean)){
    current=current?current+'/'+name:name;let folder=byPath.get(current);
    if(!folder){folder={id:'import:'+current,path:current,name,parentId,order:Number.MAX_SAFE_INTEGER};all.push(folder);byPath.set(current,folder);}
    parentId=folder.id;
  }}
  return folderOptions(all);
}

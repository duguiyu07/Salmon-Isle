import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {db} from './db';
import {digest} from './crypto';
import {atomicWrite,articleMeta,listArticles,listFolders,reindex,saveArticle,saveFolder} from './storage';
import {activeRoot,isDesktop,runtimeDir,workspaceRoot,withLibrary,repositoryConfig} from './library-context';
import {libraryDirectories,libraryFiles,validateLibrary,validatePortablePath} from './library-validation';
import {listMedia} from './media';
import {within} from './paths';
import {AppError} from './model';
import type {SyncFile,SyncPatch} from './sync-model';

export const directRoot=()=>path.join(runtimeDir(),'library-v2');
const directRegistry=globalThis as typeof globalThis&{salmonDirectInitialized?:Set<string>};
const initialized=directRegistry.salmonDirectInitialized??=new Set<string>();
const binaryHashes=new Map<string,{stamp:string;hash:string}>();
export function syncDb(){const database=db();database.exec(`
 CREATE TABLE IF NOT EXISTS sync_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sync_outbox(id TEXT PRIMARY KEY,kind TEXT NOT NULL,target TEXT,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sync_receipts(id TEXT PRIMARY KEY,seq INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sync_journal(id TEXT PRIMARY KEY,before_state TEXT NOT NULL,paths TEXT);
 CREATE TABLE IF NOT EXISTS sync_devices(id TEXT PRIMARY KEY,secret TEXT NOT NULL,credential TEXT NOT NULL,created TEXT NOT NULL);
`);return database;}
export function meta(key:string,fallback=''){return (syncDb().prepare('SELECT value FROM sync_meta WHERE key=?').get(key) as {value:string}|undefined)?.value??fallback;}
export function setMeta(key:string,value:string){syncDb().prepare('INSERT OR REPLACE INTO sync_meta VALUES(?,?)').run(key,value);}
export function libraryIdentity(){return {libraryId:meta('libraryId'),generation:meta('generation'),cursor:Number(meta('cursor','0'))};}
export function blobPath(hash:string){if(!/^[a-f0-9]{64}$/.test(hash))throw new AppError('无效附件哈希');return path.join(runtimeDir(),'sync-blobs',hash);}
export function keepBlob(bytes:Buffer){const hash=digest(bytes),file=blobPath(hash);if(!fs.existsSync(file))atomicWrite(file,bytes);return hash;}
function managed(file:string){validatePortablePath(file);if(file!=='library.json'&&!libraryDirectories.some(dir=>file.startsWith(dir+'/')))throw new AppError('文件不属于内容库');}
export function snapshot(root=workspaceRoot(),paths?:string[]):SyncFile[]{
 const names=paths??libraryFiles(root).filter(file=>file==='library.json'||libraryDirectories.some(dir=>file.startsWith(dir+'/')));
 return names.filter(file=>{managed(file);return fs.existsSync(within(root,file))&&fs.statSync(within(root,file)).isFile();}).map(file=>{
  const absolute=within(root,file),manifest=path.join(path.dirname(absolute),'manifest.json');const blob=file.startsWith('media/')||file.startsWith('trash/')&&path.posix.basename(file)==='content'&&fs.existsSync(manifest)&&JSON.parse(fs.readFileSync(manifest,'utf8')).kind==='media';
  if(blob){const stat=fs.statSync(absolute,{bigint:true}),stamp=String(stat.mtimeNs)+':'+String(stat.ctimeNs)+':'+String(stat.size),cached=binaryHashes.get(absolute);if(cached?.stamp===stamp&&fs.existsSync(blobPath(cached.hash)))return {path:file,hash:cached.hash,blob:true};const hash=keepBlob(fs.readFileSync(absolute));binaryHashes.set(absolute,{stamp,hash});return {path:file,hash,blob:true};}
  const bytes=fs.readFileSync(absolute);return {path:file,hash:digest(bytes),data:bytes.toString('base64')};
 });
}
export function difference(before:SyncFile[],after:SyncFile[]):SyncPatch{const previous=new Map(before.map(file=>[file.path,file.hash]));const current=new Set(after.map(file=>file.path));return {files:after.filter(file=>previous.get(file.path)!==file.hash),deleted:before.filter(file=>!current.has(file.path)).map(file=>file.path)};}
export function applyPatch(patch:SyncPatch,root=workspaceRoot()){
 for(const file of patch.files){managed(file.path);const bytes=file.blob?fs.readFileSync(blobPath(file.hash)):Buffer.from(file.data||'','base64');if(digest(bytes)!==file.hash)throw new AppError('文件校验失败');atomicWrite(within(root,file.path),bytes);}
 for(const file of patch.deleted){managed(file);const target=within(root,file);if(fs.existsSync(target)&&fs.statSync(target).isFile())fs.unlinkSync(target);}
 // Empty directories otherwise leave phantom folders after moves and trash operations.
 const prune=(dir:string)=>{if(!fs.existsSync(dir))return;for(const item of fs.readdirSync(dir,{withFileTypes:true}))if(item.isDirectory()&&!item.isSymbolicLink()){const child=path.join(dir,item.name);prune(child);if(!fs.readdirSync(child).length)fs.rmdirSync(child);}};
 for(const dir of ['content','trash'])prune(path.join(root,dir));
}
export function prepareChange(paths?:string[]){const id=randomUUID(),before=snapshot(workspaceRoot(),paths);syncDb().prepare('INSERT INTO sync_journal VALUES(?,?,?)').run(id,JSON.stringify(before),paths?JSON.stringify(paths):null);return {id,before,paths};}
export function finishChange(id:string){syncDb().prepare('DELETE FROM sync_journal WHERE id=?').run(id);}
export function recoverChanges(){const rows=syncDb().prepare('SELECT * FROM sync_journal').all() as {id:string;before_state:string;paths:string|null}[];for(const row of rows){const before=JSON.parse(row.before_state) as SyncFile[],now=snapshot(workspaceRoot(),row.paths?JSON.parse(row.paths):undefined);applyPatch({files:before,deleted:now.filter(file=>!before.some(old=>old.path===file.path)).map(file=>file.path)});finishChange(row.id);}if(rows.length)withLibrary(workspaceRoot(),()=>reindex());}
export function beginDirectLibrary(){
 const marker=path.join(runtimeDir(),'direct-library.json'),restored=path.join(runtimeDir(),'sync-restored.json');if(fs.existsSync(marker)){if(fs.existsSync(restored)){setMeta('generation',randomUUID());setMeta('cursor','0');syncDb().exec('DELETE FROM sync_devices; DELETE FROM sync_receipts;');fs.unlinkSync(restored);}if(!initialized.has(runtimeDir())){recoverChanges();initialized.add(runtimeDir());}return;}
 const root=directRoot(),legacy=workspaceRoot(),live=activeRoot(),config=repositoryConfig();
 const hasContent=[legacy,live].some(dir=>fs.existsSync(path.join(dir,'content'))&&fs.readdirSync(path.join(dir,'content')).length);
 if(hasContent){const directory=path.join(runtimeDir(),'backups');fs.mkdirSync(directory,{recursive:true});
  // Load lazily: backup also imports library-context and storage.
  const backup=path.join(directory,'before-2.0-'+Date.now());fs.mkdirSync(backup,{recursive:true});
  for(const [index,source] of [...new Set([legacy,live,runtimeDir()])].entries()){
   const target=path.join(backup,String(index));fs.mkdirSync(target);for(const entry of fs.readdirSync(source,{withFileTypes:true})){if(entry.isSymbolicLink()||['backups','library-v2','library-indexes','sync-blobs','imports'].includes(entry.name)||entry.name.endsWith('.salmon-lock'))continue;
    const full=path.join(source,entry.name);if(path.resolve(full)===root||path.resolve(full).startsWith(backup+path.sep))continue;fs.cpSync(full,path.join(target,entry.name),{recursive:true});}
  }
  atomicWrite(path.join(backup,'sources.json'),JSON.stringify({legacy,live,config}));
 }
 const stage=path.join(runtimeDir(),'library-v2-staging');if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true});
 const media=withLibrary(legacy,()=>listMedia());
 const copy=(source:string,dir:string)=>{const full=path.join(source,dir);if(fs.existsSync(full))fs.cpSync(full,path.join(stage,dir),{recursive:true,filter:file=>!fs.lstatSync(file).isSymbolicLink()});};
 for(const dir of libraryDirectories){fs.mkdirSync(path.join(stage,dir));copy(live,dir);}
 if(live!==legacy){for(const dir of ['media','media-meta','editor-drafts','trash'])copy(legacy,dir);
  const folders=withLibrary(legacy,()=>listFolders()).filter(folder=>folder.id!=='root').sort((a,b)=>a.path.split('/').length-b.path.split('/').length);
  withLibrary(stage,()=>{for(const folder of folders){const existing=listFolders();if(existing.some(item=>item.id===folder.id))continue;const parent=existing.find(item=>item.id===folder.parentId);if(!parent)continue;let name=folder.name;if(existing.some(item=>item.parentId===parent.id&&item.name===name))name+=' (恢复 '+folder.id.slice(0,4)+')';saveFolder({...folder,name,parentId:parent.id},{create:true,policy:{access:folder.access,...(folder.passwordHash?{passwordHash:folder.passwordHash}:{})}});}});
  const pending=withLibrary(legacy,()=>listArticles());
  withLibrary(stage,()=>{for(const article of pending){let base=listArticles().find(item=>item.id===article.id);if(base&&base.version===article.version)continue;
   const folder=listFolders().some(item=>item.id===article.folderId)?article.folderId:'root';
   if(!base)base=saveArticle({...article,body:'',status:'draft',folderId:folder},{create:true});
   const draft=path.join(stage,'editor-drafts',article.id+'.json');if(!fs.existsSync(draft))atomicWrite(draft,JSON.stringify({articleId:article.id,baseVersion:base.version,draftVersion:randomUUID(),savedAt:new Date().toISOString(),document:{...articleMeta(article),body:article.body,folderId:folder,status:base.status}}));
  }});
 }
 for(const item of media)if(!fs.existsSync(path.join(stage,'media-meta',item.id+'.json')))atomicWrite(path.join(stage,'media-meta',item.id+'.json'),JSON.stringify(item));
 atomicWrite(path.join(stage,'library.json'),JSON.stringify({version:1}));
 // Draft bases from a prepared 1.x publication must point at the actual live article.
 withLibrary(stage,()=>{const articles=listArticles();for(const file of fs.readdirSync(path.join(stage,'editor-drafts'))){const target=path.join(stage,'editor-drafts',file),draft=JSON.parse(fs.readFileSync(target,'utf8')),base=articles.find(item=>item.id===draft.articleId);if(base){draft.baseVersion=base.version;if(!listFolders().some(folder=>folder.id===draft.document.folderId))draft.document.folderId=base.folderId;atomicWrite(target,JSON.stringify(draft));}}});
 validateLibrary(stage);if(fs.existsSync(root))fs.rmSync(root,{recursive:true,force:true});fs.renameSync(stage,root);
 setMeta('libraryId',randomUUID());setMeta('generation',randomUUID());setMeta('cursor','0');
 atomicWrite(marker,JSON.stringify({version:2,root,time:new Date().toISOString(),desktop:isDesktop()}));if(fs.existsSync(restored))fs.unlinkSync(restored);withLibrary(root,()=>reindex());recoverChanges();initialized.add(runtimeDir());
}

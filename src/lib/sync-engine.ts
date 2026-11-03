import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {beginDirectLibrary,blobPath,difference,finishChange,libraryIdentity,meta,prepareChange,recoverChanges,setMeta,snapshot,syncDb,applyPatch,keepBlob} from './direct-library';
import {runtimeDir,isDesktop,workspaceRoot,withWorkspace} from './library-context';
import {atomicWrite,findArticle,getSettings,reindex,listArticles,listFolders,saveArticle,saveFolder,articleMeta,invalidateLibraryCache,splitMarkdown} from './storage';
import {readEditorDraft} from './editor-drafts';
import {referencedMediaIds} from './media-references';
import {getMedia} from './media';
import {pushEditorDraft,unpublishWithEditorDraft} from './editor-drafts';
import {validateLibrary} from './library-validation';
import {withRepositoryLock} from './repository-lock';
import {AppError} from './model';
import type {SyncConnection,SyncOperation,SyncReceipt,SyncStatus,SyncFile,SyncPatch} from './sync-model';
import {draftFingerprint} from './editor-draft-model';
import type {DraftTokens} from './editor-draft-model';

interface Worker {secret:string;running?:Promise<void>;timer?:ReturnType<typeof setTimeout>;events?:AbortController;lastSyncedAt?:string;error?:string;offline?:boolean;blocked?:boolean;retry:number}
const registry=globalThis as typeof globalThis&{salmonDirectWorkers?:Map<string,Worker>};
function worker(){registry.salmonDirectWorkers??=new Map();let state=registry.salmonDirectWorkers.get(runtimeDir());if(!state){state={secret:process.env.SALMON_SYNC_TOKEN||'',retry:0};registry.salmonDirectWorkers.set(runtimeDir(),state);}return state;}
const connectionFile=()=>path.join(runtimeDir(),'sync-connection.json');
export function syncConnection():SyncConnection|null{return fs.existsSync(connectionFile())?JSON.parse(fs.readFileSync(connectionFile(),'utf8')):null;}
function saveConnection(value:SyncConnection){atomicWrite(connectionFile(),JSON.stringify(value));}
export function syncStatus():SyncStatus{const state=worker(),connection=syncConnection();const pending=Number((syncDb().prepare('SELECT COUNT(*) AS n FROM sync_outbox').get() as {n:number}).n);return {phase:!connection?'unconfigured':state.error&&!state.offline?'error':state.offline?'offline':state.running||pending?'syncing':'synced',siteUrl:connection?.siteUrl,pending,connected:!!connection,lastSyncedAt:state.lastSyncedAt,error:state.error};}
function siteUrl(value:string){const url=new URL(value);if(url.username||url.password||url.search||url.hash||url.protocol!=='https:'&&!(process.env.SALMON_ALLOW_HTTP_SYNC==='true'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new AppError('请使用 HTTPS 网站地址');return url.origin;}
async function remote(route:string,options:RequestInit={},connection=syncConnection(),secret=worker().secret){
 if(!connection||!secret)throw new AppError('请先连接网站',401);
 let response:Response;try{response=await fetch(connection.siteUrl+'/api/sync/v1/'+route,{...options,headers:{Authorization:'Bearer '+secret,...options.headers},cache:'no-store',signal:options.signal||AbortSignal.timeout(20000)});}catch{throw new AppError('网站暂不可达，本地内容已保留',503);}
 if(!response.ok){const value=await response.json().catch(()=>({}));throw new AppError(value.error||'同步失败',response.status);}return response;
}
export async function connectSite(input:{siteUrl:string;password:string;replace?:boolean}){
 beginDirectLibrary();await worker().running?.catch(()=>{});const url=siteUrl(input.siteUrl);let response:Response;
 try{response=await fetch(url+'/api/sync/v1/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:input.password,replace:!!input.replace}),signal:AbortSignal.timeout(20000)});}catch{throw new AppError('无法连接网站，请检查地址和网络',503);}
 const data=await response.json().catch(()=>({}));if(!response.ok)throw new AppError(data.error||'网站需要先升级至 2.0',response.status);if(data.protocol!==1)throw new AppError('请先升级网站至兼容版本',426);
 const connection:SyncConnection={siteUrl:url,deviceId:data.deviceId,libraryId:data.libraryId,generation:data.generation,cursor:0};
 const state=worker();state.events?.abort();state.secret=data.secret;state.error=undefined;state.offline=false;state.blocked=false;
 // Never overwrite an offline library: retain its complete files for explicit recovery.
 if(snapshot().some(file=>file.path!=='library.json')){
  const id=randomUUID(),recovery=path.join(runtimeDir(),'sync-recovery',id);fs.mkdirSync(recovery,{recursive:true});fs.cpSync(workspaceRoot(),path.join(recovery,'library'),{recursive:true});atomicWrite(path.join(recovery,'manifest.json'),JSON.stringify({id,time:new Date().toISOString(),title:'连接前的本地内容'}));
 }
 const bootstrap=await (await remote('bootstrap',{},connection,data.secret)).json();
 for(const file of bootstrap.files as SyncFile[])if(file.blob&&!fs.existsSync(blobPath(file.hash)))keepBlob(Buffer.from(await(await remote('media/'+file.hash,{},connection,data.secret)).arrayBuffer()));
 const before=snapshot();const journal=prepareChange();try{applyPatch({files:bootstrap.files,deleted:before.filter(file=>!bootstrap.files.some((next:SyncFile)=>next.path===file.path)).map(file=>file.path)});invalidateLibraryCache();withWorkspace(()=>reindex());syncDb().prepare('DELETE FROM sync_outbox').run();finishChange(journal.id);}catch(error){recoverChanges();throw error;}
 connection.cursor=bootstrap.cursor;saveConnection(connection);if(bootstrap.settings)atomicWrite(path.join(runtimeDir(),'site.yml'),bootstrap.settings);
 state.lastSyncedAt=new Date().toISOString();startDirectSync();return {status:syncStatus(),secret:data.secret};
}
export function disconnectSite(){const state=worker();state.events?.abort();if(state.timer)clearTimeout(state.timer);state.secret='';if(fs.existsSync(connectionFile()))fs.unlinkSync(connectionFile());return syncStatus();}
export async function localMutation<T>(kind:'draft'|'structural',target:string|undefined,action:()=>Promise<T>|T,paths?:string[]):Promise<T>{
 const journal=prepareChange(paths);try{
  const result=await action();if(kind==='structural')invalidateLibraryCache();const after=snapshot(workspaceRoot(),paths),patch=difference(journal.before,after);
  if(patch.files.length||patch.deleted.length){const connection=syncConnection(),identity=connection||libraryIdentity();
   const operation:SyncOperation={id:randomUUID(),kind,target,patch,libraryId:identity.libraryId,generation:identity.generation};const database=syncDb();database.exec('BEGIN IMMEDIATE');try{
    if(kind==='draft'&&target){const previous=database.prepare("SELECT id,payload FROM sync_outbox WHERE kind='draft' AND target=? AND state='pending' ORDER BY created DESC LIMIT 1").get(target) as {id:string;payload:string}|undefined;
     if(previous){const old=JSON.parse(previous.payload) as SyncOperation;const files=new Map(old.patch!.files.map(file=>[file.path,file]));for(const file of patch.files)files.set(file.path,file);for(const file of patch.deleted)files.delete(file);operation.patch={files:[...files.values()],deleted:[...new Set([...old.patch!.deleted,...patch.deleted])].filter(file=>!files.has(file))};database.prepare('DELETE FROM sync_outbox WHERE id=?').run(previous.id);}
    }
    database.prepare('INSERT INTO sync_outbox(id,kind,target,payload,created) VALUES(?,?,?,?,?)').run(operation.id,kind,target||null,JSON.stringify(operation),Date.now());finishChange(journal.id);database.exec('COMMIT');
   }catch(error){database.exec('ROLLBACK');throw error;}
  }else finishChange(journal.id);
  kickSync();return result;
 }catch(error){recoverChanges();invalidateLibraryCache();throw error;}
}
export function draftPaths(id:string,document:{title?:string;folderId?:string}){
 const existing=withWorkspace(()=>findArticle(id));if(existing)return ['content/'+existing.path,'editor-drafts/'+id+'.json'];
 const folder=withWorkspace(()=>listFolders().find(item=>item.id===(document.folderId||'root')));const title=(document.title?.trim()||'无标题文章').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/^[. ]+|[. ]+$/g,'').slice(0,100);
 return ['content/'+path.posix.join(folder?.path||'',title+'--'+id+'.md'),'editor-drafts/'+id+'.json'];
}
export function applyServerOperation(operation:SyncOperation):SyncReceipt{
 const identity=libraryIdentity();if(operation.libraryId!==identity.libraryId||operation.generation!==identity.generation)throw new AppError('服务器内容库已恢复，请保留本地稿并重新连接',409);
 const existing=syncDb().prepare('SELECT payload FROM sync_receipts WHERE id=?').get(operation.id) as {payload:string}|undefined;if(existing){const receipt=JSON.parse(existing.payload) as SyncReceipt;return operation.kind==='draft'||operation.kind==='structural'?{id:receipt.id,cursor:receipt.cursor}:receipt;}
 const journal=prepareChange(operation.kind==='draft'?operation.patch?.files.map(file=>file.path):undefined);try{
  let result:unknown;
  if(operation.kind==='publish'||operation.kind==='unpublish'){
   if(!operation.target||!operation.tokens)throw new AppError('发布参数不完整');result=operation.kind==='publish'?pushEditorDraft(operation.target,operation.tokens):unpublishWithEditorDraft(operation.target,operation.tokens);
  }else{
   if(!operation.patch)throw new AppError('同步内容为空');
   if(operation.kind==='draft'){if(operation.patch.deleted.length)throw new AppError('草稿不能删除正式内容');for(const file of operation.patch.files){if(file.path.startsWith('content/')){const previous=journal.before.find(old=>old.path===file.path);if(previous&&previous.hash!==file.hash)throw new AppError('草稿不能直接改写已保存的正式文章',409);const value=splitMarkdown(Buffer.from(file.data||'','base64').toString('utf8'));if(value.meta.status!=='draft'||value.body.trim())throw new AppError('新建草稿不能直接发布');}else if(file.path!=='editor-drafts/'+operation.target+'.json')throw new AppError('草稿同步范围无效');}}
   applyPatch(operation.patch);
  }
  if(operation.kind==='draft'){
   if(operation.patch?.files.some(file=>file.path.startsWith('content/')))invalidateLibraryCache();
   const draft=operation.target?readEditorDraft(operation.target):null,article=operation.target?findArticle(operation.target):null;
   if(!draft||!article||draft.baseVersion!==article.version||typeof draft.document.body!=='string'||draft.document.body.length>10*1024*1024||!listFolders().some(folder=>folder.id===draft.document.folderId)||/"password"\s*:/.test(JSON.stringify(draft)))throw new AppError('草稿格式或保存基线无效',409);
   for(const id of referencedMediaIds(draft))if(!getMedia(id))throw new AppError('草稿引用的附件尚未同步',409);
  }else{invalidateLibraryCache();validateLibrary(workspaceRoot());const settings=getSettings(),folders=new Set(listFolders().map(folder=>folder.id));if(settings.knowledgeRootId&&!folders.has(settings.knowledgeRootId)||settings.homeFolders.some(id=>!folders.has(id)))throw new AppError('网站设置仍引用此文件夹，请先在在线后台调整设置',409);reindex();}
  const cursor=identity.cursor+1,patch=difference(journal.before,snapshot(workspaceRoot(),journal.paths)),receipt:SyncReceipt={id:operation.id,cursor,...(['publish','unpublish'].includes(operation.kind)?{patch,result}:{})};
  const database=syncDb();database.exec('BEGIN IMMEDIATE');try{database.prepare('INSERT INTO sync_receipts VALUES(?,?,?)').run(operation.id,cursor,JSON.stringify({...receipt,patch}));setMeta('cursor',String(cursor));finishChange(journal.id);database.exec('COMMIT');}catch(error){database.exec('ROLLBACK');throw error;}return receipt;
 }catch(error){recoverChanges();invalidateLibraryCache();throw error;}
}
async function sendOutbox(){
 const connection=syncConnection(),secret=worker().secret;if(!connection)throw new AppError('请先连接网站',401);
 const sameConnection=()=>syncConnection()?.deviceId===connection.deviceId&&worker().secret===secret;
 while(sameConnection()){
  // Network IO must never own the library lock. Freeze just one outgoing row,
  // then let autosave keep writing/coalescing subsequent operations independently.
  const row=await withRepositoryLock(()=>{const row=syncDb().prepare('SELECT id,payload FROM sync_outbox ORDER BY rowid LIMIT 1').get() as {id:string;payload:string}|undefined;if(row)syncDb().prepare("UPDATE sync_outbox SET state='sent' WHERE id=?").run(row.id);return row;});
  if(!row)break;const operation=JSON.parse(row.payload) as SyncOperation;
  for(const file of operation.patch?.files||[])if(file.blob){try{await remote('media/'+file.hash,{method:'HEAD'},connection,secret);}catch(error){if((error as AppError).status!==404)throw error;await remote('media/'+file.hash,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array(fs.readFileSync(blobPath(file.hash))),signal:AbortSignal.timeout(180000)},connection,secret);}}
  const receipt:SyncReceipt=await (await remote('operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(operation)},connection,secret)).json();
  await withRepositoryLock(()=>{
   if(!sameConnection())return;
   if(receipt.patch){
    const draftPath=operation.target?'editor-drafts/'+operation.target+'.json':null;
    const local=operation.target?readEditorDraft(operation.target):null;
    const preserve=local&&local.draftVersion!==operation.tokens?.draftVersion?local:null;
    const patch=preserve&&draftPath?{files:receipt.patch.files.filter(file=>file.path!==draftPath),deleted:receipt.patch.deleted.filter(file=>file!==draftPath)}:receipt.patch;
    const journal=prepareChange([...new Set([...receipt.patch.files.map(file=>file.path),...receipt.patch.deleted,...(draftPath?[draftPath]:[])])]);
    try{
     applyPatch(patch);invalidateLibraryCache();
     if(preserve&&draftPath&&operation.target){
      const article=findArticle(operation.target);if(!article)throw new AppError('发布后文章不存在',409);
      preserve.baseVersion=article.version;preserve.baseDocument={...articleMeta(article),body:article.body,folderId:article.folderId};preserve.document.status=article.status;atomicWrite(path.join(workspaceRoot(),draftPath),JSON.stringify(preserve));
      const updated=snapshot(workspaceRoot(),[draftPath])[0];
      for(const pending of syncDb().prepare("SELECT id,payload FROM sync_outbox WHERE kind='draft' AND target=? AND state='pending'").all(operation.target)){
       const next=JSON.parse(String(pending.payload)) as SyncOperation;next.patch!.files=next.patch!.files.map(file=>file.path===draftPath?updated:file);syncDb().prepare('UPDATE sync_outbox SET payload=? WHERE id=?').run(JSON.stringify(next),pending.id);
      }
     }
     reindex();finishChange(journal.id);
    }catch(error){recoverChanges();throw error;}
   }
   syncDb().prepare('DELETE FROM sync_outbox WHERE id=?').run(row.id);connection.cursor=receipt.cursor;saveConnection(connection);
  });
 }
 worker().lastSyncedAt=new Date().toISOString();
}
async function pullChanges(){const connection=syncConnection();if(!connection)return;const data=await(await remote('changes?after='+connection.cursor)).json();if(data.libraryId!==connection.libraryId||data.generation!==connection.generation)throw new AppError('服务器内容库已恢复，请重新连接；本地改动会保留',409);
 if(data.settings)atomicWrite(path.join(runtimeDir(),'site.yml'),data.settings);connection.cursor=data.cursor;saveConnection(connection);
}
export async function flushSync(){
 const state=worker();if(state.running){await state.running;if((syncDb().prepare('SELECT COUNT(*) AS n FROM sync_outbox').get() as {n:number}).n)return flushSync();return;}
 state.blocked=false;const device=syncConnection()?.deviceId;
 let task!:Promise<void>;task=(async()=>{try{await withWorkspace(sendOutbox);if(syncConnection()?.deviceId===device){state.error=undefined;state.offline=false;state.retry=0;}}catch(error){if(syncConnection()?.deviceId===device){state.error=(error as Error).message;state.offline=(error as AppError).status>=500;state.blocked=[400,401,403,409,413,422].includes((error as AppError).status);}throw error;}finally{if(state.running===task)state.running=undefined;}})();
 state.running=task;return task;
}
export async function publishFromDesktop(id:string,tokens:DraftTokens,withdraw=false){
 const connection=syncConnection();if(!connection)throw new AppError('请先连接网站，联网后发布',409);
 const kind=withdraw?'unpublish':'publish',previous=syncDb().prepare('SELECT payload FROM sync_outbox WHERE kind=? AND target=? LIMIT 1').get(kind,id) as {payload:string}|undefined;
 await remote('identity');await flushSync();
 if(syncConnection()?.deviceId!==connection.deviceId)throw new AppError('连接已改变，请在同步页确认发布状态',409);
 if(previous&&(JSON.parse(previous.payload) as SyncOperation).tokens?.draftVersion===tokens.draftVersion){const article=findArticle(id);if(!article)throw new AppError('文章不存在',404);return withdraw?{article,draft:readEditorDraft(id)}:article;}
 await withRepositoryLock(()=>{const draft=readEditorDraft(id);if(!draft||draft.draftVersion!==tokens.draftVersion||!previous&&draft.baseVersion!==tokens.baseVersion)throw new AppError('内容已更新，当前输入已保留，请重新载入',409);const operation:SyncOperation={id:randomUUID(),kind,target:id,tokens:{baseVersion:draft.baseVersion,draftVersion:draft.draftVersion},libraryId:connection.libraryId,generation:connection.generation};syncDb().prepare('INSERT INTO sync_outbox(id,kind,target,payload,created) VALUES(?,?,?,?,?)').run(operation.id,kind,id,JSON.stringify(operation),Date.now());});
 await flushSync();const article=withWorkspace(()=>findArticle(id));if(!article)throw new AppError('文章不存在',404);
 if(withdraw){const {readEditorDraft}=await import('./editor-drafts');return {article,draft:withWorkspace(()=>readEditorDraft(id))};}return article;
}
export function recoveryList(){const root=path.join(runtimeDir(),'sync-recovery');return fs.existsSync(root)?fs.readdirSync(root).flatMap(id=>{const file=path.join(root,id,'manifest.json');return fs.existsSync(file)?[JSON.parse(fs.readFileSync(file,'utf8'))]:[];}):[];}
export async function importRecovery(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new AppError('恢复记录无效');const source=path.join(runtimeDir(),'sync-recovery',id,'library');const {withLibrary}=await import('./library-context');const previous=withLibrary(source,()=>listArticles());const {readEditorDraft,saveEditorDraft}=await import('./editor-drafts');let count=0;
 await localMutation('structural',undefined,()=>{let folder:ReturnType<typeof saveFolder>|undefined;const assets=snapshot(source).filter(file=>file.path.startsWith('media/')||file.path.startsWith('media-meta/'));
  for(const article of previous){const old=withLibrary(source,()=>readEditorDraft(article.id));const current=findArticle(article.id);const body=old?.document.body??article.body;const remoteDraft=current?readEditorDraft(current.id):null;const incoming={...article,...(old?.document||{}),body},present=remoteDraft?.document||current;if(present&&draftFingerprint(incoming)===draftFingerprint(present)&&incoming.passwordHash===present.passwordHash)continue;if(!folder)folder=saveFolder({name:'恢复的本地内容 '+new Date().toISOString().slice(0,10)+' '+id.slice(0,4)});
   for(const file of assets){const target=path.join(workspaceRoot(),file.path);if(!fs.existsSync(target))applyPatch({files:[file],deleted:[]});}
   const newId=randomUUID(),rewrite=(value:string|undefined)=>value?.replace(/(\/api\/media\/[a-zA-Z0-9_-]+)(?:\?[^\s<>"')}]*)?/g,(_match,url:string)=>url+'?article='+newId);
   const original={...articleMeta(article),...(old?.document||{})};const document={...original,title:old?.document.title||article.title,body:rewrite(body)!,cover:rewrite(original.cover),css:rewrite(original.css),folderId:folder.id,status:'draft' as const,route:undefined,aliases:[]};saveEditorDraft(newId,document,{baseVersion:null,draftVersion:null});count++;
  }});atomicWrite(path.join(runtimeDir(),'sync-recovery',id,'manifest.json'),JSON.stringify({id,time:new Date().toISOString(),title:'已导入的本地内容',imported:true}));return {count};
}
function listenEvents(){const state=worker();if(state.events||!syncConnection()||!state.secret)return;const controller=new AbortController();state.events=controller;
 void (async()=>{try{const response=await remote('events',{signal:controller.signal});const reader=response.body?.getReader();if(!reader)return;let buffer='';const decoder=new TextDecoder();for(;;){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});let index;while((index=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,index);buffer=buffer.slice(index+2);if(event.includes('data:'))kickSync();}}}catch{}finally{if(state.events===controller)state.events=undefined;if(!controller.signal.aborted)kickSync();}})();
}
export function kickSync(){if(!isDesktop()||!syncConnection())return;const state=worker();if(state.blocked)return;if(state.timer)clearTimeout(state.timer);state.timer=setTimeout(()=>{void (async()=>{try{await flushSync();await pullChanges();listenEvents();state.retry=0;}catch(error){state.error=(error as Error).message;state.offline=(error as AppError).status>=500;state.blocked=[400,401,403,409,413,422].includes((error as AppError).status);}finally{if(!state.blocked){state.timer=setTimeout(kickSync,state.offline?Math.min(30000,1000*2**Math.min(5,state.retry++)):15000);state.timer.unref();}}})() ;},40);state.timer.unref();}
export function startDirectSync(){if(!isDesktop())return;kickSync();}

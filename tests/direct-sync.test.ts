import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {beginDirectLibrary,libraryIdentity,syncDb,prepareChange,recoverChanges} from '../src/lib/direct-library';
import {localMutation,draftPaths,applyServerOperation,importRecovery} from '../src/lib/sync-engine';
import {addMedia,mediaUrl} from '../src/lib/media';
import {saveEditorDraft,readEditorDraft} from '../src/lib/editor-drafts';
import {findArticle,atomicWrite,invalidateLibraryCache,saveArticle,saveFolder,listFolders} from '../src/lib/storage';
import {workspaceRoot,withWorkspace,withLibrary} from '../src/lib/library-context';
import {closeDatabases} from '../src/lib/db';
import {backupData,restoreData} from '../src/lib/backup';
import type {SyncOperation} from '../src/lib/sync-model';
const previous={...process.env};let root:string;
function enter(name:string){process.env.SALMON_DATA_DIR=path.join(root,name);process.env.SALMON_DESKTOP=name==='client'?'true':'false';invalidateLibraryCache();beginDirectLibrary();}
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-direct-'));delete process.env.SALMON_CONTENT_REPO_DIR;delete process.env.SALMON_CONTENT_REMOTE;});
afterEach(()=>{closeDatabases();for(const key of Object.keys(process.env))if(key.startsWith('SALMON_'))delete process.env[key];Object.assign(process.env,Object.fromEntries(Object.entries(previous).filter(([key])=>key.startsWith('SALMON_'))));fs.rmSync(root,{recursive:true,force:true});});
test('offline drafts coalesce durably, synchronize idempotently and publish only on an explicit operation',async()=>{
 enter('server');const identity=libraryIdentity();enter('client');const id=randomUUID();let result:any;
 await withWorkspace(()=>localMutation('draft',id,()=>result=saveEditorDraft(id,{title:'离线文章',body:'first',folderId:'root'},{baseVersion:null,draftVersion:null}),draftPaths(id,{title:'离线文章'})));
 await withWorkspace(()=>localMutation('draft',id,()=>result=saveEditorDraft(id,{title:'离线文章',body:'latest',folderId:'root'},{baseVersion:result.draft.baseVersion,draftVersion:result.draft.draftVersion}),draftPaths(id,{title:'离线文章'})));
 const rows=syncDb().prepare('SELECT payload FROM sync_outbox').all();assert.equal(rows.length,1);const operation={...JSON.parse(String(rows[0].payload)),...identity} as SyncOperation;
 enter('server');withWorkspace(()=>{const first=applyServerOperation(operation);assert.equal(findArticle(id)?.status,'draft');assert.equal(readEditorDraft(id)?.document.body,'latest');assert.deepEqual(applyServerOperation(operation),first);
 const publish:SyncOperation={id:randomUUID(),kind:'publish',target:id,tokens:{baseVersion:result.draft.baseVersion,draftVersion:result.draft.draftVersion},...identity};applyServerOperation(publish);assert.equal(findArticle(id)?.status,'published');assert.equal(findArticle(id)?.body.trim(),'latest');assert.equal(readEditorDraft(id),null);assert.equal(applyServerOperation(publish).cursor,2);});
});
test('an interrupted local write rolls back before synchronization and preserves the last draft',()=>{enter('client');withWorkspace(()=>{const file='editor-drafts/'+randomUUID()+'.json';prepareChange([file]);atomicWrite(path.join(workspaceRoot(),file),'interrupted');recoverChanges();assert.equal(fs.existsSync(path.join(workspaceRoot(),file)),false);});});
test('restoring a deployment tar backup changes its generation and revokes the old device',()=>{enter('server');const before=libraryIdentity();syncDb().prepare('INSERT INTO sync_devices VALUES(?,?,?,?)').run('old','secret','fingerprint','now');atomicWrite(path.join(process.env.SALMON_DATA_DIR!,'sync-restored.json'),'{}');beginDirectLibrary();assert.notEqual(libraryIdentity().generation,before.generation);assert.equal(syncDb().prepare('SELECT * FROM sync_devices').all().length,0);});
test('invalid remote data cannot replace valid content and a restored backup invalidates device credentials',()=>{enter('server');const identity=libraryIdentity();withWorkspace(()=>{
 assert.throws(()=>applyServerOperation({id:randomUUID(),kind:'structural',...identity,patch:{files:[{path:'../admin.json',hash:'0'.repeat(64),data:''}],deleted:[]}}));assert.equal(libraryIdentity().cursor,0);
 syncDb().prepare('INSERT INTO sync_devices VALUES(?,?,?,?)').run('old','secret','fingerprint','now');const bytes=backupData(),target=path.join(root,'restored');restoreData(bytes,target);const old=identity.generation;process.env.SALMON_DATA_DIR=target;assert.notEqual(libraryIdentity().generation,old);assert.equal(syncDb().prepare('SELECT * FROM sync_devices').all().length,0);
 });});
test('1.x migration keeps the actual public article, preserves prepared changes as drafts and retains new folder IDs',()=>{
 process.env.SALMON_DATA_DIR=path.join(root,'legacy-runtime');process.env.SALMON_DESKTOP='false';const work=path.join(root,'legacy-work'),revision='a'.repeat(40),live=path.join(process.env.SALMON_DATA_DIR,'library-releases',revision);fs.mkdirSync(work,{recursive:true});atomicWrite(path.join(work,'library.json'),JSON.stringify({version:1}));atomicWrite(path.join(process.env.SALMON_DATA_DIR,'library-connection.json'),JSON.stringify({workspace:work,remote:'https://example.test/content.git',branch:'main',siteUrl:''}));
 const original=withLibrary(work,()=>saveArticle({title:'网站文章',body:'公开正文',status:'published'}));fs.mkdirSync(path.dirname(live),{recursive:true});fs.cpSync(work,live,{recursive:true});atomicWrite(path.join(process.env.SALMON_DATA_DIR,'library-active.json'),JSON.stringify({revision}));
 withLibrary(work,()=>saveArticle({...original,body:'尚未上线的正文'}));const folder=withLibrary(work,()=>saveFolder({name:'新草稿目录'}));const extra=withLibrary(work,()=>saveArticle({title:'尚未发布',body:'本地正文',folderId:folder.id}));
 beginDirectLibrary();withWorkspace(()=>{assert.equal(findArticle(original.id)?.body.trim(),'公开正文');assert.equal(readEditorDraft(original.id)?.document.body.trim(),'尚未上线的正文');assert.equal(findArticle(extra.id)?.status,'draft');assert.equal(readEditorDraft(extra.id)?.document.body.trim(),'本地正文');assert.ok(listFolders().some(item=>item.id===folder.id));});const before=libraryIdentity();beginDirectLibrary();assert.deepEqual(libraryIdentity(),before);
});
test('recovery copies remain private and attachment URLs are rebound to the recovered article',async()=>{enter('client');await withWorkspace(async()=>{let original=saveArticle({id:'recovery-origin',title:'原文章',body:'before',status:'published'},{create:true});const media=addMedia('image.png',Buffer.from([1,2,3]),original.id);original=saveArticle({...original,body:'![图片]('+mediaUrl(media.id,original.id)+')',cover:mediaUrl(media.id,original.id)});const id=randomUUID(),directory=path.join(process.env.SALMON_DATA_DIR!,'sync-recovery',id);fs.mkdirSync(directory,{recursive:true});fs.cpSync(workspaceRoot(),path.join(directory,'library'),{recursive:true});atomicWrite(path.join(directory,'manifest.json'),JSON.stringify({id,time:new Date().toISOString(),title:'恢复'}));saveArticle({...original,body:'服务器最新正文',cover:undefined});const result=await importRecovery(id);assert.equal(result.count,1);const drafts=fs.readdirSync(path.join(workspaceRoot(),'editor-drafts')).map(file=>JSON.parse(fs.readFileSync(path.join(workspaceRoot(),'editor-drafts',file),'utf8')));const draft=drafts.find(item=>item.articleId!==original.id);assert.ok(draft);assert.match(draft.document.body,new RegExp('article='+draft.articleId));assert.equal(draft.document.cover,mediaUrl(media.id,draft.articleId));assert.equal(findArticle(draft.articleId)?.status,'draft');assert.equal(findArticle(original.id)?.body.trim(),'服务器最新正文');});});

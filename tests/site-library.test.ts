import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {beginDirectLibrary,libraryIdentity,prepareChange,recoverChanges} from '../src/lib/direct-library';
import {withWorkspace,withLibrary,workspaceRoot} from '../src/lib/library-context';
import {findArticle,saveArticle,saveFolder,listFolders,atomicWrite} from '../src/lib/storage';
import {readEditorDraft,saveEditorDraft} from '../src/lib/editor-drafts';
import {convertLegacyPage} from '../src/lib/page-migration';
import {backupData,restoreData} from '../src/lib/backup';
import {closeDatabases} from '../src/lib/db';
let root:string;const previous={...process.env};
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-site-library-'));delete process.env.SALMON_CONTENT_REPO_DIR;});
afterEach(()=>{closeDatabases();for(const key of Object.keys(process.env))if(key.startsWith('SALMON_'))delete process.env[key];Object.assign(process.env,Object.fromEntries(Object.entries(previous).filter(([key])=>key.startsWith('SALMON_'))));fs.rmSync(root,{recursive:true,force:true});});
test('1.x migration keeps the actual public article, preserves prepared changes as drafts and retains new folder IDs',()=>{
 process.env.SALMON_DATA_DIR=path.join(root,'legacy-runtime');process.env.SALMON_DESKTOP='false';const work=path.join(root,'legacy-work'),revision='a'.repeat(40),live=path.join(process.env.SALMON_DATA_DIR,'library-releases',revision);fs.mkdirSync(work,{recursive:true});atomicWrite(path.join(work,'library.json'),JSON.stringify({version:1}));atomicWrite(path.join(process.env.SALMON_DATA_DIR,'library-connection.json'),JSON.stringify({workspace:work,remote:'https://example.test/content.git',branch:'main',siteUrl:''}));
 const original=withLibrary(work,()=>saveArticle({title:'网站文章',body:'公开正文',status:'published'}));fs.mkdirSync(path.dirname(live),{recursive:true});fs.cpSync(work,live,{recursive:true});atomicWrite(path.join(process.env.SALMON_DATA_DIR,'library-active.json'),JSON.stringify({revision}));
 withLibrary(work,()=>saveArticle({...original,body:'尚未上线的正文'}));const folder=withLibrary(work,()=>saveFolder({name:'新草稿目录'}));const extra=withLibrary(work,()=>saveArticle({title:'尚未发布',body:'本地正文',folderId:folder.id}));
 beginDirectLibrary();withWorkspace(()=>{assert.equal(findArticle(original.id)?.body.trim(),'公开正文');assert.equal(readEditorDraft(original.id)?.document.body.trim(),'尚未上线的正文');assert.equal(findArticle(extra.id)?.status,'draft');assert.equal(readEditorDraft(extra.id)?.document.body.trim(),'本地正文');assert.ok(listFolders().some(item=>item.id===folder.id));});const before=libraryIdentity();beginDirectLibrary();assert.deepEqual(libraryIdentity(),before);
});

test('unfinished website writes recover before reopening the library',()=>{
 process.env.SALMON_DATA_DIR=path.join(root,'site');beginDirectLibrary();withWorkspace(()=>{prepareChange();atomicWrite(path.join(workspaceRoot(),'editor-drafts','interrupted.json'),'interrupted');recoverChanges();assert.equal(fs.existsSync(path.join(workspaceRoot(),'editor-drafts','interrupted.json')),false);});
});

test('2.x backups restore the live library and drafts to a fresh runtime',()=>{
 process.env.SALMON_DATA_DIR=path.join(root,'original');beginDirectLibrary();const article=withWorkspace(()=>saveArticle({title:'Keep me',body:'LIVE',status:'published'}));
 withWorkspace(()=>saveEditorDraft(article.id,{...article,body:'UNPUBLISHED'},{baseVersion:article.version,draftVersion:null}));
 const bytes=withWorkspace(()=>backupData()),target=path.join(root,'restored');restoreData(bytes,target);process.env.SALMON_DATA_DIR=target;beginDirectLibrary();assert.equal(withWorkspace(()=>findArticle(article.id)!.body.trim()),'LIVE');assert.equal(withWorkspace(()=>readEditorDraft(article.id)!.document.body),'UNPUBLISHED');
});

test('legacy page conversion keeps staged edits inside the active 2.x library',async()=>{
 process.env.SALMON_DATA_DIR=path.join(root,'pages');beginDirectLibrary();await withWorkspace(async()=>{
 const page=saveArticle({title:'Legacy',kind:'page',body:'# Live page',status:'published',aliases:['/legacy']});saveEditorDraft(page.id,{...page,body:'# Unsaved page content'},{baseVersion:page.version,draftVersion:null});
 const converted=await convertLegacyPage(page),draft=readEditorDraft(page.id)!;assert.equal(draft.baseVersion,converted.version);assert.equal(draft.document.contentFormat,'html');assert.match(draft.document.body,/<h1.*Unsaved page content/);
 assert.equal(fs.existsSync(path.join(process.env.SALMON_DATA_DIR!,'editor-drafts',page.id+'.json')),false);
 });
});

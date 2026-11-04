import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {batchArticles} from '../src/lib/article-batch';
import {beginDirectLibrary} from '../src/lib/direct-library';
import {withWorkspace} from '../src/lib/library-context';
import {saveArticle,saveFolder,findArticle,searchIndex} from '../src/lib/storage';
import {saveEditorDraft,readEditorDraft} from '../src/lib/editor-drafts';
import {closeDatabases} from '../src/lib/db';import {verifyPassword} from '../src/lib/crypto';
let root:string;const previous={...process.env};
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-batch-'));process.env.SALMON_DATA_DIR=root;delete process.env.SALMON_CONTENT_REPO_DIR;beginDirectLibrary();});
afterEach(()=>{closeDatabases();for(const key of Object.keys(process.env))if(key.startsWith('SALMON_'))delete process.env[key];Object.assign(process.env,Object.fromEntries(Object.entries(previous).filter(([key])=>key.startsWith('SALMON_'))));fs.rmSync(root,{recursive:true,force:true});});
const item=(id:string)=>withWorkspace(()=>({id,baseVersion:findArticle(id)!.version,draftVersion:readEditorDraft(id)?.draftVersion||null}));
test('moves and access changes take effect immediately and rebase unpublished text',async()=>withWorkspace(async()=>{
 const article=saveArticle({title:'原文章',body:'LIVE',status:'published'}),target=saveFolder({name:'新位置'});
 saveEditorDraft(article.id,{...article,title:'未发布标题',body:'UNPUBLISHED'},{baseVersion:article.version,draftVersion:null});
 const old=item(article.id);await batchArticles({action:'move',articles:[old],folderId:target.id});
 let current=findArticle(article.id)!,draft=readEditorDraft(article.id)!;assert.equal(current.folderId,target.id);assert.equal(draft.document.folderId,target.id);assert.equal(draft.baseVersion,current.version);assert.equal(draft.document.body,'UNPUBLISHED');assert.equal(current.body.trim(),'LIVE');
 await assert.rejects(batchArticles({action:'access',articles:[old],access:'private'}),/其他窗口/);
 await batchArticles({action:'access',articles:[item(article.id)],access:'password',password:'new-shared-password'});
 current=findArticle(article.id)!;draft=readEditorDraft(article.id)!;assert.ok(verifyPassword('new-shared-password',current.passwordHash!));assert.ok(verifyPassword('new-shared-password',draft.document.passwordHash!));assert.equal(draft.document.body,'UNPUBLISHED');
}));
test('publication uses saved drafts, skips clean live posts and withdrawal retains drafts',async()=>withWorkspace(async()=>{
 const article=saveArticle({title:'A',body:'old',status:'published'}),clean=saveArticle({title:'Clean',body:'clean',status:'published'});
 saveEditorDraft(article.id,{...article,body:'LATEST_SAVED'},{baseVersion:article.version,draftVersion:null});
 const result=await batchArticles({action:'publish',articles:[item(article.id),item(clean.id)]});assert.deepEqual(result,{changed:1,skipped:1});assert.equal(findArticle(article.id)!.body.trim(),'LATEST_SAVED');assert.equal(readEditorDraft(article.id),null);assert.ok(searchIndex('LATEST_SAVED').has(article.id));
 await batchArticles({action:'unpublish',articles:[item(article.id)]});assert.equal(findArticle(article.id)!.status,'draft');assert.equal(readEditorDraft(article.id)!.document.body.trim(),'LATEST_SAVED');
}));
test('a later invalid publication rolls back earlier posts, draft removals and the search index',async()=>withWorkspace(async()=>{
 const good=saveArticle({title:'Good',body:'ORIGINAL',status:'published'});saveEditorDraft(good.id,{...good,body:'NEVER_LEAK'},{baseVersion:good.version,draftVersion:null});
 const bad=saveEditorDraft('untitled',{title:'',body:'incomplete',folderId:'root'},{baseVersion:null,draftVersion:null});
 const before=item(good.id);await assert.rejects(batchArticles({action:'publish',articles:[before,item(bad.article.id)]}),/标题/);
 assert.equal(findArticle(good.id)!.version,before.baseVersion);assert.equal(findArticle(good.id)!.body.trim(),'ORIGINAL');assert.equal(readEditorDraft(good.id)!.draftVersion,before.draftVersion);assert.equal(searchIndex('NEVER_LEAK').size,0);
}));
test('invalid targets, empty passwords and stale drafts leave the whole selection unchanged',async()=>withWorkspace(async()=>{
 const article=saveArticle({title:'A',body:'body',status:'published'}),before=item(article.id);
 await assert.rejects(batchArticles({action:'move',articles:[before],folderId:'missing'}),/目标/);await assert.rejects(batchArticles({action:'access',articles:[before],access:'password',password:''}),/密码/);
 saveEditorDraft(article.id,{...article,body:'new'},{baseVersion:article.version,draftVersion:null});await assert.rejects(batchArticles({action:'unpublish',articles:[before]}),/其他窗口/);assert.equal(findArticle(article.id)!.status,'published');
}));

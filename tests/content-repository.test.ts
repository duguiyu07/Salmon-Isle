import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {git,createEmptyLibrary,initializeRepository,commitAndPush,synchronizeRepository,repositoryStatus,conflicts,resolveConflict,commitHistory,fileDiff} from '../src/lib/content-repository';
import {withWorkspace,withPublicLibrary,withLibrary,activeRevision,workspaceRoot,libraryRoot} from '../src/lib/library-context';
import {saveArticle,findArticle,listArticles,saveFolder,trashItem,restoreItem,atomicWrite,splitMarkdown,markdownFile} from '../src/lib/storage';
import type {ArticleMeta} from '../src/lib/model';
import {saveEditorDraft,readEditorDraft,pushEditorDraft,unpublishWithEditorDraft} from '../src/lib/editor-drafts';
import {addMedia,deleteMedia,mediaReferences,mediaUrl,getMedia} from '../src/lib/media';
import {validateLibrary} from '../src/lib/library-validation';
import {backupData,restoreData} from '../src/lib/backup';
import {closeDatabases} from '../src/lib/db';
import {migrateGit} from '../src/lib/git-migration';
import {randomBytes} from 'node:crypto';

let root:string,remote:string;const previous={...process.env};
function client(name:string,desktop=true){process.env.SALMON_DATA_DIR=path.join(root,name+'-runtime');process.env.SALMON_CONTENT_REPO_DIR=path.join(root,name+'-repo');process.env.SALMON_CONTENT_REMOTE=remote;process.env.SALMON_CONTENT_BRANCH='main';process.env.SALMON_DESKTOP=String(desktop);delete process.env.SALMON_SITE_URL;}
async function seed(){client('desktop');await createEmptyLibrary(workspaceRoot());await initializeRepository({workspace:workspaceRoot(),remote,branch:'main',siteUrl:''});const article=withWorkspace(()=>saveArticle({title:'文章 A',body:'first\nsecond\n',status:'published'}));await commitAndPush('initial','initial');return article.id;}
beforeEach(async()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-git-'));remote=path.join(root,'remote.git');process.env.SALMON_DATA_DIR=path.join(root,'bootstrap');process.env.SALMON_ALLOW_LOCAL_GIT='true';await git(['init','--bare','--initial-branch=main',remote],{cwd:root});});
afterEach(()=>{closeDatabases();for(const key of Object.keys(process.env))if(key.startsWith('SALMON_'))delete process.env[key];Object.assign(process.env,Object.fromEntries(Object.entries(previous).filter(([key])=>key.startsWith('SALMON_'))));fs.rmSync(root,{recursive:true,force:true});});

test('draft saves do not commit; publication and withdrawal activate only after a complete push',async()=>{
  client('desktop');await createEmptyLibrary(workspaceRoot());await initializeRepository({workspace:workspaceRoot(),remote,branch:'main',siteUrl:''});
  const id='draft-example';const saved=withWorkspace(()=>saveEditorDraft(id,{title:'离线草稿',body:'private draft',folderId:'root',kind:'post'},{baseVersion:null,draftVersion:null}));
  assert.equal((await commitHistory()).length,0);await commitAndPush('sync draft','draft-sync');
  client('server',false);await synchronizeRepository();assert.equal(withPublicLibrary(()=>findArticle(id)?.body.trim()),'');assert.equal(withPublicLibrary(()=>findArticle(id)?.status),'draft');assert.equal(withWorkspace(()=>readEditorDraft(id)?.document.body),'private draft');
  const liveDraft=activeRevision();client('desktop');withWorkspace(()=>pushEditorDraft(id,{baseVersion:saved.article.version,draftVersion:saved.draft.draftVersion}));assert.equal((await commitHistory()).length,1);
  await commitAndPush('publish','publish-one');assert.equal((await commitHistory()).length,2);
  client('server',false);assert.equal(activeRevision(),liveDraft);await synchronizeRepository();assert.equal(withPublicLibrary(()=>findArticle(id)?.body.trim()),'private draft');assert.equal(withPublicLibrary(()=>findArticle(id)?.status),'published');
  client('desktop');const article=withWorkspace(()=>findArticle(id)!);const edit=withWorkspace(()=>saveEditorDraft(id,{...article,body:'new draft'},{baseVersion:article.version,draftVersion:null}));withWorkspace(()=>unpublishWithEditorDraft(id,{baseVersion:article.version,draftVersion:edit.draft.draftVersion}));
  client('server',false);assert.equal(withPublicLibrary(()=>findArticle(id)?.status),'published');client('desktop');await commitAndPush('withdraw','withdraw-one');client('server',false);await synchronizeRepository();assert.equal(withPublicLibrary(()=>findArticle(id)?.status),'draft');
});

test('two clients merge independent edits without overwriting dirty workspaces; IDs survive folder moves',async()=>{
  const id=await seed();client('server',false);await synchronizeRepository();
  const folder=withWorkspace(()=>saveFolder({name:'新目录'}));const second=withWorkspace(()=>saveArticle({title:'文章 B',body:'server content',status:'published',folderId:folder.id}));
  await commitAndPush('online edit','online-one');
  client('desktop');await synchronizeRepository(false);assert.equal(withWorkspace(()=>findArticle(second.id)),undefined,'background fetch must not replace an open editor base, even before its first autosave');
  client('desktop');const article=withWorkspace(()=>findArticle(id)!);withWorkspace(()=>saveEditorDraft(id,{...article,body:'local unfinished'},{baseVersion:article.version,draftVersion:null}));
  client('desktop');await synchronizeRepository(false);assert.equal(withWorkspace(()=>findArticle(second.id)),undefined);assert.equal(withWorkspace(()=>readEditorDraft(id)?.document.body),'local unfinished');assert.ok((await repositoryStatus()).behind>0);
  await synchronizeRepository(true);assert.ok(withWorkspace(()=>findArticle(second.id)));assert.equal(withWorkspace(()=>readEditorDraft(id)?.document.body),'local unfinished');
  const moved=withWorkspace(()=>saveFolder({...folder,name:'重命名目录'}));assert.equal(moved.id,folder.id);assert.equal(withWorkspace(()=>findArticle(second.id)?.folderId),folder.id);await commitAndPush('move and draft','desktop-two');client('server',false);await synchronizeRepository();assert.equal(withPublicLibrary(()=>findArticle(second.id)?.id),second.id);
});

test('conflicting edits retain base and both sides, then can be resolved and submitted',async()=>{
  const id=await seed();client('server',false);await synchronizeRepository();const online=withWorkspace(()=>findArticle(id)!);withWorkspace(()=>saveArticle({...online,body:'server conflicting text'}));await commitAndPush('server edit','conflict-server');
  client('desktop');const local=withWorkspace(()=>findArticle(id)!);withWorkspace(()=>saveArticle({...local,body:'desktop conflicting text'}));await assert.rejects(()=>synchronizeRepository(true),/冲突/);
  const list=await conflicts();assert.ok(list.length);assert.match(list[0].base,/first/);assert.match(list[0].local+list[0].remote,/desktop conflicting text/);assert.match(list[0].local+list[0].remote,/server conflicting text/);
  await resolveConflict(list[0].path,'manual',markdownFile(splitMarkdown(list[0].local).meta as ArticleMeta,'resolved content'));
  assert.equal((await conflicts()).length,0);await commitAndPush('resolved','resolve-one');client('server',false);await synchronizeRepository();assert.match(withPublicLibrary(()=>findArticle(id)!.body),/resolved content/);
});

test('a failed push retries the existing commit and leaves subsequent edits for the next submission',async()=>{
  const id=await seed(),article=withWorkspace(()=>findArticle(id)!);withWorkspace(()=>saveArticle({...article,body:'ready for submission'}));await git(['config','remote.origin.pushurl',path.join(root,'missing.git')]);
  await assert.rejects(()=>commitAndPush('push fails','retry-operation'));const history=await commitHistory();assert.equal(history.length,2);assert.equal((await repositoryStatus()).ahead,1);
  const current=withWorkspace(()=>findArticle(id)!);withWorkspace(()=>saveEditorDraft(id,{...current,body:'typing after failed push'},{baseVersion:current.version,draftVersion:null}));await git(['config','--unset','remote.origin.pushurl']);
  await commitAndPush('must not duplicate','retry-operation');assert.equal((await commitHistory()).length,2);assert.equal((await repositoryStatus()).ahead,0);assert.ok((await repositoryStatus()).changes.length);assert.equal(withWorkspace(()=>readEditorDraft(id)?.document.body),'typing after failed push');
  await commitAndPush('same request retried','retry-operation');assert.equal((await commitHistory()).length,2);
});

test('invalid remote snapshots cannot replace the last valid public release',async()=>{
  const id=await seed();client('server',false);await synchronizeRepository();const live=activeRevision();
  client('desktop');atomicWrite(path.join(workspaceRoot(),'.env'),'SHOULD_NEVER_BE_PUBLISHED=secret');await git(['add','--all']);await git(['commit','-m','invalid external commit']);await git(['push','origin','HEAD:main']);
  client('server',false);await assert.rejects(()=>synchronizeRepository(),/不允许/);assert.equal(activeRevision(),live);assert.equal(withPublicLibrary(()=>findArticle(id)?.status),'published');assert.match((await repositoryStatus()).error||'',/不允许/);
});

test('media metadata is versioned, references block deletion, and backup restores Git and pending work',async()=>{
  const id=await seed();const media=withWorkspace(()=>addMedia('figure.png',Buffer.from([137,80,78,71])));const article=withWorkspace(()=>findArticle(id)!);withWorkspace(()=>saveArticle({...article,body:'![figure]('+mediaUrl(media.id,id)+')'}));
  assert.equal(withWorkspace(()=>mediaReferences(media.id)).length,1);assert.throws(()=>withWorkspace(()=>deleteMedia(media.id)),/解除/);
  const saved=withWorkspace(()=>findArticle(id)!);withWorkspace(()=>saveArticle({...saved,body:'no image'}));const removed=withWorkspace(()=>deleteMedia(media.id));assert.equal(withWorkspace(()=>getMedia(media.id)),undefined);withWorkspace(()=>restoreItem(removed.id));assert.equal(withWorkspace(()=>getMedia(media.id)?.name),'figure.png');validateLibrary(workspaceRoot());
  const backup=withWorkspace(()=>backupData()),restored=path.join(root,'restored');restoreData(backup,restored);const connection=JSON.parse(fs.readFileSync(path.join(restored,'library-connection.json'),'utf8'));assert.equal(connection.workspace,path.join(restored,'content-repository'));assert.ok(fs.existsSync(path.join(connection.workspace,'.git','HEAD')));assert.ok(fs.existsSync(path.join(connection.workspace,'media-meta',media.id+'.json')));
  const diff=await fileDiff('media-meta/'+media.id+'.json');assert.match(diff.after,/figure.png/);assert.equal(withWorkspace(()=>listArticles()).length,1);
  const image=await fileDiff('media/'+media.id);assert.equal(image.binary,true);assert.equal(image.beforeExists,false);assert.equal(image.afterExists,true);
});

test('a remote publication and a local editor draft produce a resolvable semantic conflict',async()=>{
  const id=await seed();client('server',false);await synchronizeRepository();const server=withWorkspace(()=>findArticle(id)!);withWorkspace(()=>saveArticle({...server,body:'new published server version'}));await commitAndPush('online publication','semantic-online');
  client('desktop');const original=withWorkspace(()=>findArticle(id)!);withWorkspace(()=>saveEditorDraft(id,{...original,body:'my unfinished draft'},{baseVersion:original.version,draftVersion:null}));await synchronizeRepository(true);
  const conflict=await conflicts();assert.equal(conflict[0].path,'editor-drafts/'+id+'.json');assert.match(conflict[0].local,/my unfinished draft/);assert.match(conflict[0].remote,/new published server version/);assert.match(conflict[0].base,/first/);
  await assert.rejects(()=>commitAndPush('blocked','semantic-blocked'),/编辑稿/);await resolveConflict(conflict[0].path,'local');assert.equal((await conflicts()).length,0);assert.equal(withWorkspace(()=>readEditorDraft(id)?.document.body),'my unfinished draft');await commitAndPush('merged draft','semantic-resolved');
});

test('migration previews without creating a repository, preserves the original, and is idempotent',async()=>{
  const cwd=process.cwd();process.chdir(root);
  try{
    delete process.env.SALMON_CONTENT_REPO_DIR;delete process.env.SALMON_CONTENT_REMOTE;process.env.SALMON_DATA_DIR=path.join(root,'legacy');delete process.env.SALMON_DESKTOP;
    const article=saveArticle({title:'迁移内容',body:'original source',status:'published'}),media=addMedia('original.png',Buffer.from([137,80,78,71]),article.id),target=path.join(root,'migrated');
    const preview=await migrateGit(target);assert.equal('dryRun' in preview&&preview.dryRun,true);assert.equal(fs.existsSync(target),false);
    const migrated=await migrateGit(target,true);assert.equal(migrated.alreadyApplied,false);assert.ok('backup' in migrated&&fs.existsSync(migrated.backup));assert.equal(withLibrary(target,()=>findArticle(article.id)?.id),article.id);assert.equal(withLibrary(target,()=>getMedia(media.id)?.name),media.name);
    withLibrary(target,()=>saveArticle({...findArticle(article.id)!,body:'later edit'}));assert.equal((await migrateGit(target,true)).alreadyApplied,true);assert.match(withLibrary(target,()=>findArticle(article.id)!.body),/later edit/);assert.match(findArticle(article.id)!.body,/original source/);
  }finally{process.chdir(cwd);}
});

test('deleting and restoring a folder retains its nested saved editor drafts',async()=>{
  await seed();const folder=withWorkspace(()=>saveFolder({name:'待删除目录'}));const draft=withWorkspace(()=>saveEditorDraft('nested-draft',{title:'nested draft',body:'keep this unfinished text',folderId:folder.id,kind:'post'},{baseVersion:null,draftVersion:null}));await commitAndPush('add folder and draft','nested-initial');
  const removed=withWorkspace(()=>trashItem(folder.id,'folder'));validateLibrary(workspaceRoot());await commitAndPush('remove folder','nested-delete');client('server',false);await synchronizeRepository();assert.equal(withWorkspace(()=>findArticle(draft.article.id)),undefined);
  withWorkspace(()=>restoreItem(removed.id));assert.equal(withWorkspace(()=>readEditorDraft(draft.article.id)?.document.body),'keep this unfinished text');validateLibrary(workspaceRoot());await commitAndPush('restore folder','nested-restore');
});

test('a batch of binary media larger than 160 MiB can be committed and synchronized',async()=>{
  await seed();
  for(let index=0;index<5;index++)withWorkspace(()=>addMedia('large-'+index+'.zip',randomBytes(33*1024*1024)));
  await commitAndPush('large media batch','large-batch');client('server',false);await synchronizeRepository();
  assert.equal(withPublicLibrary(()=>validateLibrary(libraryRoot())).media,5);
});

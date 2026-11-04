import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createEmptyLibrary} from '../src/lib/library-copy';
import {withWorkspace,workspaceRoot,runtimeDir} from '../src/lib/library-context';
import {saveArticle,saveFolder,findArticle,trashItem,restoreItem,atomicWrite} from '../src/lib/storage';
import {addMedia,queryMedia,mediaReferences,mediaUrl,deleteMedia,getMedia} from '../src/lib/media';
import {mediaReferenceDocument,replaceMediaReference,referencedMediaIds} from '../src/lib/media-references';
import {saveEditorDraft,readEditorDraft} from '../src/lib/editor-drafts';
import {validateLibrary} from '../src/lib/library-validation';
import {libraryTransaction,recoverLibraryTransaction} from '../src/lib/library-transaction';
import {digest} from '../src/lib/crypto';
import {closeDatabases} from '../src/lib/db';
const previous={...process.env};let root:string;
beforeEach(async()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-media-ui-'));process.env.SALMON_DATA_DIR=path.join(root,'runtime');process.env.SALMON_CONTENT_REPO_DIR=path.join(root,'work');delete process.env.SALMON_CONTENT_REMOTE;
  await createEmptyLibrary(workspaceRoot());
});
afterEach(()=>{closeDatabases();for(const key of Object.keys(process.env))if(key.startsWith('SALMON_'))delete process.env[key];Object.assign(process.env,Object.fromEntries(Object.entries(previous).filter(([key])=>key.startsWith('SALMON_'))));assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'salmon-media-ui-'));fs.rmSync(root,{recursive:true,force:true});});
test('media pagination filters globally before slicing and clamps empty or deleted pages',()=>withWorkspace(()=>{
  for(let i=0;i<51;i++)addMedia('picture-'+String(i).padStart(2,'0')+'.png',Buffer.from('image'));
  addMedia('manual.pdf',Buffer.from('pdf'));addMedia('clip.mp4',Buffer.from('video'));addMedia('song.mp3',Buffer.from('audio'));
  assert.equal(queryMedia().items.length,24);assert.equal(queryMedia({page:3}).items.length,6);assert.equal(queryMedia({page:999}).page,3);
  assert.equal(queryMedia({type:'image'}).total,51);assert.equal(queryMedia({type:'other'}).total,1);
  assert.equal(queryMedia({q:'PICTURE-4',page:2}).total,10);assert.equal(queryMedia({q:'PICTURE-4',page:2}).page,1);
  assert.equal(queryMedia({usage:'unused'}).total,54);assert.equal(queryMedia({q:'missing'}).pages,1);
}));
test('reference filters include canonical content, editor merge baselines and trash with stable preview targets',()=>withWorkspace(()=>{
  const media=addMedia('figure.png',Buffer.from('image'));
  const article=saveArticle({title:'Baseline article',body:'![figure]('+mediaUrl(media.id,'reference-post')+')',id:'reference-post'},{create:true});
  saveEditorDraft(article.id,{...article,body:'removed in draft'},{baseVersion:article.version,draftVersion:null});
  saveArticle({...article,body:'removed from canonical'});
  assert.equal(queryMedia({usage:'active'}).total,1);assert.equal(queryMedia({usage:'unused'}).total,0);
  const ref=mediaReferences(media.id).find(ref=>ref.field.includes('合并基线'))!;assert.ok(ref);assert.match(mediaReferenceDocument(ref.href.split('/').pop()!)!.article.body,/figure/);
  assert.throws(()=>deleteMedia(media.id,true),/解除/);
  trashItem(article.id,'article');
  assert.ok(mediaReferences(media.id).every(ref=>ref.kind==='trash'));assert.equal(queryMedia({usage:'trash'}).total,1);
}));
test('trash-only force deletion replaces nested folder content and drafts; restore retains placeholders and valid versions',()=>withWorkspace(()=>{
  const media=addMedia('figure.png',Buffer.from('image')),folder=saveFolder({name:'Nested'});
  const article=saveArticle({id:'nested-post',title:'Nested article',folderId:folder.id,body:'![original alt]('+mediaUrl(media.id,'nested-post')+')',cover:mediaUrl(media.id,'nested-post')},{create:true});
  saveEditorDraft(article.id,{...article,body:article.body+'\ncaption remains'},{baseVersion:article.version,draftVersion:null});
  const trash=trashItem(folder.id,'folder');const refs=mediaReferences(media.id);
  assert.ok(refs.length>=4);assert.ok(refs.every(ref=>ref.kind==='trash'&&ref.trashId===trash.id));
  assert.equal(mediaReferenceDocument(refs[0].href.split('/').pop()!)!.kind,'trash');
  assert.throws(()=>deleteMedia(media.id),/解除/);const result=deleteMedia(media.id,true);
  assert.ok(result.replaced>=4);assert.equal(getMedia(media.id),undefined);assert.equal(mediaReferences(media.id).length,0);validateLibrary(workspaceRoot());
  restoreItem(trash.id);const restored=findArticle(article.id)!;
  assert.match(restored.body,/original alt/);assert.match(restored.body,/\/media-deleted.svg/);assert.equal(readEditorDraft(article.id)!.baseVersion,restored.version);
  assert.match(readEditorDraft(article.id)!.document.body,/caption remains/);validateLibrary(workspaceRoot());
}));
test('replacement preserves alt text and avoids partial IDs across escaped and entity URLs',()=>{
  const value='![keep alt](https://site.test/api/media/abc-def?article=post) <img src="&#47;api&#47;media&#47;abc-def?article=post"> /api/media/abc-def-more';
  const result=replaceMediaReference(value,'abc-def') as string;
  assert.match(result,/!\[keep alt\]\(\/media-deleted.svg\)/);assert.equal(referencedMediaIds(result).has('abc-def'),false);assert.match(result,/\/api\/media\/abc-def-more/);
});
test('failed and interrupted library transactions restore every changed file',()=>withWorkspace(()=>{
  const file='content/transaction.md',absolute=path.join(workspaceRoot(),file);atomicWrite(absolute,'before');
  assert.throws(()=>libraryTransaction([file,'media/new'],()=>{atomicWrite(absolute,'after');atomicWrite(path.join(workspaceRoot(),'media/new'),'new');throw new Error('interrupted');}),/interrupted/);
  assert.equal(fs.readFileSync(absolute,'utf8'),'before');assert.equal(fs.existsSync(path.join(workspaceRoot(),'media/new')),false);
  const journal=path.join(runtimeDir(),'library-transactions',digest(path.resolve(workspaceRoot())));fs.mkdirSync(journal,{recursive:true});
  fs.writeFileSync(path.join(journal,'0'),'before crash');fs.writeFileSync(path.join(journal,'transaction.json'),JSON.stringify({root:workspaceRoot(),done:false,files:[{name:file,exists:true}]}));
  recoverLibraryTransaction();assert.equal(fs.readFileSync(absolute,'utf8'),'before crash');
}));

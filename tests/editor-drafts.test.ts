import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {saveEditorDraft,pushEditorDraft,unpublishWithEditorDraft,readEditorDraft,clientEditorDraft,listEditorDrafts} from '../src/lib/editor-drafts';
import {saveArticle,findArticle,saveFolder,trashItem,restoreItem} from '../src/lib/storage';
import {closeDatabases} from '../src/lib/db';
import {verifyPassword} from '../src/lib/crypto';
import {backupData,restoreData} from '../src/lib/backup';
import {DraftSaveSession,type SaveStatus} from '../src/lib/draft-save-session';
import type {DraftDocument,DraftSaveResult,DraftTokens} from '../src/lib/editor-draft-model';
import {imageMarkdown} from '../src/lib/image-caption';
import {parseVisualMarkdown,serializeVisualMarkdown} from '../src/lib/visual-schema';
import {renderMarkdown} from '../src/lib/markdown';
import {createTestEditor} from './helpers/visual-editor';
import {load} from 'cheerio';
import {sourceInsertionLine} from '../src/lib/editor-block';
import {blockAtLine} from '../src/lib/editor-block';
import {editorViewCtx} from '@milkdown/kit/core';
import {NodeSelection} from '@milkdown/kit/prose/state';
import {editorInsertions} from '../src/lib/editor-insertions';
import {undo} from '@milkdown/kit/prose/history';

let directory:string;
beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-editor-drafts-'));process.env.SALMON_DATA_DIR=directory;});
afterEach(()=>{closeDatabases();fs.rmSync(directory,{recursive:true,force:true});});
const tokens=(draft:{baseVersion:string;draftVersion:string})=>({baseVersion:draft.baseVersion,draftVersion:draft.draftVersion});

test('editor drafts stage all changes and passwords without updating the live article',()=>{
  const article=saveArticle({title:'正式标题',body:'正式正文',status:'published'}),folder=saveFolder({name:'新目录'});
  const saved=saveEditorDraft(article.id,{...article,title:'编辑标题',body:'编辑正文',folderId:folder.id,access:'password',password:'staged-secret'},{baseVersion:article.version,draftVersion:null});
  assert.equal(findArticle(article.id)!.body.trim(),'正式正文');assert.equal(findArticle(article.id)!.title,'正式标题');assert.equal(findArticle(article.id)!.folderId,'root');assert.equal(findArticle(article.id)!.access,'inherit');
  const disk=fs.readFileSync(path.join(directory,'editor-drafts',article.id+'.json'),'utf8');assert.doesNotMatch(disk,/staged-secret/);assert.equal(verifyPassword('staged-secret',saved.draft.document.passwordHash),true);assert.doesNotMatch(JSON.stringify(clientEditorDraft(saved.draft)),/scrypt|staged-secret/);
  const live=pushEditorDraft(article.id,tokens(saved.draft));assert.equal(live.title,'编辑标题');assert.equal(live.folderId,folder.id);assert.equal(live.body.trim(),'编辑正文');assert.equal(live.status,'published');assert.equal(verifyPassword('staged-secret',live.passwordHash),true);assert.equal(readEditorDraft(article.id),null);
});
test('stable untitled drafts are private, restore across trash and backup, and require a title to publish',()=>{
  const id=randomUUID(),saved=saveEditorDraft(id,{title:'',body:'未命名正文',folderId:'root'},{baseVersion:null,draftVersion:null});
  assert.equal(saved.article.id,id);assert.equal(saved.article.status,'draft');assert.equal(saved.draft.document.title,'');assert.equal(listEditorDrafts()[0].title,'无标题文章');
  assert.throws(()=>pushEditorDraft(id,tokens(saved.draft)),/填写文章标题/);
  const trash=trashItem(id,'article');assert.equal(listEditorDrafts().length,0);restoreItem(trash.id);assert.equal(readEditorDraft(id)!.document.body,'未命名正文');
  const archive=backupData(),target=path.join(directory,'restored');restoreData(archive,target);assert.equal(JSON.parse(fs.readFileSync(path.join(target,'editor-drafts',id+'.json'),'utf8')).document.body,'未命名正文');
});
test('base and draft versions reject stale writes; unpublishing preserves the staged document',()=>{
  const article=saveArticle({title:'正式标题',body:'旧内容',status:'published'});
  const first=saveEditorDraft(article.id,{...article,body:'暂存内容'},{baseVersion:article.version,draftVersion:null});
  assert.throws(()=>saveEditorDraft(article.id,{...article,body:'另一窗口'},{baseVersion:article.version,draftVersion:null}),/编辑稿已在其他窗口/);
  const withdrawn=unpublishWithEditorDraft(article.id,tokens(first.draft));assert.equal(withdrawn.article.status,'draft');assert.equal(withdrawn.draft.document.body,'暂存内容');
  const external=saveArticle({...withdrawn.article,body:'外部正式修改'});
  assert.throws(()=>pushEditorDraft(article.id,tokens(withdrawn.draft)),/正式文章已/);assert.equal(findArticle(article.id)!.version,external.version);assert.equal(readEditorDraft(article.id)!.document.body,'暂存内容');
});
function sessionFixture(save:(snapshot:DraftDocument,tokens:DraftTokens)=>Promise<DraftSaveResult>){
  let document:DraftDocument={id:'test',title:'标题',body:'原文',folderId:'root',version:'base-1'};
  const statuses:SaveStatus[]=[];
  const session=new DraftSaveSession({read:()=>document,tokens:{baseVersion:'base-1',draftVersion:null},save,push:async()=>{throw new Error('unused');},unpublish:async()=>{throw new Error('unused');},onSaved:(_result,snapshot)=>{if(document.password===snapshot.password)document={...document,password:undefined};},onPushed:()=>{},onStatus:status=>statuses.push(status)});
  return {session,change:(patch:Partial<DraftDocument>)=>{document={...document,...patch};},read:()=>document,statuses};
}
function result(snapshot:DraftDocument,version='draft-1'):DraftSaveResult{
  return {article:{...snapshot,id:'test',version:'base-1',hasPassword:false} as DraftSaveResult['article'],draft:{articleId:'test',baseVersion:'base-1',draftVersion:version,savedAt:new Date().toISOString(),document:snapshot}};
}
test('autosave uses a 60 second clock and skips unchanged documents',async context=>{
  context.mock.timers.enable({apis:['setInterval']});
  let saves=0;const fixture=sessionFixture(async snapshot=>{saves++;return result(snapshot);});fixture.session.startAutosave();
  context.mock.timers.tick(60000);await Promise.resolve();assert.equal(saves,0);
  fixture.change({body:'改变'});context.mock.timers.tick(59999);await Promise.resolve();assert.equal(saves,0);
  context.mock.timers.tick(1);await fixture.session.save();assert.equal(saves,1);assert.equal(fixture.session.dirty(),false);
  context.mock.timers.tick(120000);await fixture.session.save();assert.equal(saves,1);
});
test('in-flight saves preserve newer typing and serialize manual saves with new draft versions',async()=>{
  let release!:(value:DraftSaveResult)=>void;const requests:{snapshot:DraftDocument;tokens:DraftTokens}[]=[];
  const fixture=sessionFixture(async(snapshot,tokens)=>{requests.push({snapshot,tokens});return requests.length===1?new Promise(resolve=>{release=resolve;}):result(snapshot,'draft-2');});
  fixture.change({body:'第一版'});const first=fixture.session.save();await Promise.resolve();
  fixture.change({body:'继续输入'});const second=fixture.session.save();release(result(requests[0].snapshot));await first;
  assert.equal(fixture.read().body,'继续输入');await second;assert.equal(requests[1].snapshot.body,'继续输入');assert.equal(requests[1].tokens.draftVersion,'draft-1');assert.equal(fixture.session.dirty(),false);
});
test('network failures retry while version conflicts pause further saves',async()=>{
  let calls=0;const fixture=sessionFixture(async snapshot=>{calls++;if(calls===1)throw new Error('网络失败');if(calls===3)throw Object.assign(new Error('版本冲突'),{status:409});return result(snapshot);});
  fixture.change({body:'修改'});await assert.rejects(fixture.session.save(),/网络失败/);assert.equal(fixture.session.dirty(),true);
  await fixture.session.save();assert.equal(fixture.session.dirty(),false);fixture.change({body:'下一版'});
  await assert.rejects(fixture.session.save(),/版本冲突/);await assert.rejects(fixture.session.save(),/处理版本冲突/);assert.equal(calls,3);assert.equal(fixture.read().body,'下一版');
});
test('typing during publish remains unsaved instead of being acknowledged as published',async()=>{
  let document:DraftDocument={id:'test',title:'标题',body:'原文',folderId:'root'},release!:(article:DraftSaveResult['article'])=>void;
  const session=new DraftSaveSession({read:()=>document,tokens:{baseVersion:'base-1',draftVersion:null},save:async snapshot=>result(snapshot),push:async()=>new Promise(resolve=>{release=resolve;}),unpublish:async()=>{throw new Error('unused');},onSaved:()=>{},onPushed:()=>{},onStatus:()=>{}});
  document={...document,body:'推送快照'};const pushing=session.push();
  for(let index=0;index<8&&!release;index++)await Promise.resolve();
  assert.ok(release);document={...document,body:'推送期间继续输入'};
  release({...document,id:'test',version:'base-2',hasPassword:false} as DraftSaveResult['article']);await pushing;
  assert.equal(session.dirty(),true);assert.equal(document.body,'推送期间继续输入');
});
test('caption attributes round trip quotes, multiline Markdown, links and legacy styles without wrapper nodes',async()=>{
  const caption='第一段 **粗体** 与 [来源](https://example.test)\n\n第二段 "引号" & \\反斜线，截止 23:59。:future[原样]';
  const source=imageMarkdown({src:'/image.png',alt:'替代[文字]',title:'标题',caption,figureAttributes:{padding:'9px'}});
  const setup=await createTestEditor();try{setup.editor.action(ctx=>{
    const parsed=parseVisualMarkdown(ctx,source),node=parsed.firstChild!.firstChild!;assert.equal(node.type.name,'image');assert.equal(node.attrs.caption,caption);
    const out=serializeVisualMarkdown(ctx,parsed);assert.doesNotMatch(out,/:::figure/);assert.ok(parsed.eq(parseVisualMarkdown(ctx,out)));
  });}finally{await setup.close();}
  const $=load((await renderMarkdown(source)).html);assert.equal($('figcaption strong').text(),'粗体');assert.equal($('figcaption a').attr('href'),'https://example.test');assert.match($('figure').attr('style')||'',/padding:9px/);assert.equal($('img').attr('alt'),'替代[文字]');assert.match($('figcaption').text(),/23:59。:future\[原样\]/);
});
test('source insertion is allowed on blank prose lines but excludes code, math and table content',()=>{
  assert.equal(sourceInsertionLine('正文\n\n末尾',2),true);assert.equal(sourceInsertionLine('```js\n\n```',2),false);assert.equal(sourceInsertionLine('$$\n\n$$',2),false);assert.equal(sourceInsertionLine('正文',1),false);
});
test('source controls replace an entire legacy figure while preserving its linked image',()=>{
  const source=':::figure\n[![替代文字](/image.png "标题")](https://example.test/full)\n\n旧说明\n:::';
  const selected=blockAtLine(source,4)!;assert.equal(selected.name,'image');assert.equal(selected.attrs.linkHref,'https://example.test/full');assert.equal(selected.from,0);assert.equal(selected.to,source.length);assert.equal(selected.attrs.caption,'旧说明');
});
test('tab NodeViews expose icon actions beside the active tab and keep move/delete undoable',async()=>{
  const setup=await createTestEditor({views:true});try{setup.editor.action(ctx=>{
    const view=ctx.get(editorViewCtx),parsed=parseVisualMarkdown(ctx,editorInsertions.find(item=>item.key==='tabs')!.markdown);
    view.dispatch(view.state.tr.replaceWith(0,view.state.doc.content.size,parsed.content));
    let nav=view.dom.querySelector('.visual-tab-buttons')!;
    assert.equal(nav.querySelectorAll('.visual-tab-actions button').length,3);assert.equal((nav.querySelector('[aria-label="左移标签"]') as HTMLButtonElement).disabled,true);
    (nav.querySelectorAll('[role=tab]')[1] as HTMLButtonElement).click();nav=view.dom.querySelector('.visual-tab-buttons')!;
    assert.equal((nav.querySelector('[aria-label="右移标签"]') as HTMLButtonElement).disabled,true);
    (nav.querySelector('[aria-label="左移标签"]') as HTMLButtonElement).click();
    assert.equal(view.state.doc.firstChild!.firstChild!.attrs.attributes.title,'标签二');
    assert.ok(undo(view.state,view.dispatch));assert.equal(view.state.doc.firstChild!.firstChild!.attrs.attributes.title,'标签一');
    (view.dom.querySelector('[aria-label="删除标签"]') as HTMLButtonElement).click();
    assert.equal(view.state.doc.firstChild!.childCount,1);assert.equal((view.dom.querySelector('[aria-label="删除标签"]') as HTMLButtonElement).disabled,true);
  });}finally{await setup.close();}
});
test('image NodeViews display caption attributes and select the image without a figure editor',async()=>{
  const setup=await createTestEditor({views:true});try{setup.editor.action(ctx=>{
    const view=ctx.get(editorViewCtx),parsed=parseVisualMarkdown(ctx,':image[替代]{src="/brand/logo.png" caption="图下 **说明**"}');
    view.dispatch(view.state.tr.replaceWith(0,view.state.doc.content.size,parsed.content));
    const image=view.dom.querySelector<HTMLElement>('.visual-image')!;assert.equal(image.dataset.caption,'图下 **说明**');assert.equal(image.querySelector('img')!.alt,'替代');assert.equal(view.dom.querySelector('[data-salmon-container=figure]'),null);
    image.click();assert.ok(view.state.selection instanceof NodeSelection);assert.equal((view.state.selection as NodeSelection).node.type.name,'image');
  });}finally{await setup.close();}
});

import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError,type Article} from './model';
import {dataDir,within} from './paths';
import {atomicWrite,findArticle,listArticles,listFolders,saveArticle,articleMeta} from './storage';
import {hashPassword} from './crypto';
import type {DraftDocument,EditorDraft,EditorDraftSummary,DraftTokens,ClientEditorDraft} from './editor-draft-model';
import {libraryPath,assertLibraryWritable} from './library-context';

function draftPath(id:string){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new AppError('无效的文章 ID');
  return within(libraryPath('editor-drafts'),`${id}.json`);
}
export function readEditorDraft(id:string):EditorDraft|null{
  const file=draftPath(id);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
}
/** Published pages always use their published snapshot, even for administrators. */
export function articleForEditorViewer(article:Article,admin:boolean):Article{
  const draft=admin&&article.status==='draft'?readEditorDraft(article.id):null;
  return draft?{...article,...draft.document,id:article.id,status:article.status,version:article.version,path:article.path}:article;
}
export function clientEditorDraft(draft:EditorDraft):ClientEditorDraft{
  const {passwordHash,...document}=draft.document;
  const {baseDocument:_baseDocument,...safe}=draft;
  return {...safe,document:{...document,id:draft.articleId,hasPassword:!!passwordHash}};
}
export function listEditorDrafts():EditorDraftSummary[]{
  return listArticles().flatMap(article=>{
    const draft=readEditorDraft(article.id);
    return draft?[{articleId:article.id,title:draft.document.title||'无标题文章',folderId:draft.document.folderId,savedAt:draft.savedAt}]:[];
  });
}
function checkVersions(article:Article,draft:EditorDraft|null,tokens:DraftTokens){
  if(tokens.baseVersion!==article.version||draft&&draft.baseVersion!==article.version)
    throw new AppError('正式文章已在其他窗口修改，编辑稿已保留。请重新载入后处理冲突。',409);
  if((draft?.draftVersion||null)!==tokens.draftVersion)
    throw new AppError('编辑稿已在其他窗口修改，当前输入已保留。请重新载入后处理冲突。',409);
}
export function saveEditorDraft(id:string,input:DraftDocument,tokens:DraftTokens){
  assertLibraryWritable();
  draftPath(id);
  let article=findArticle(id);const previous=readEditorDraft(id);
  if(article){checkVersions(article,previous,tokens);if(input.kind&&input.kind!==article.kind)throw new AppError('文章与页面不能互相转换，请从对应管理入口新建');}
  else{
    if(tokens.baseVersion||tokens.draftVersion||previous)throw new AppError('文章不存在或已移入回收站',404);
    // A stable, unpublished identity also owns attachments before the first publish.
    article=saveArticle({id,title:input.title.trim()||'无标题文章',body:'',folderId:input.folderId,status:'draft',kind:input.kind,contentFormat:input.contentFormat},{create:true});
  }
  if(!listFolders().some(folder=>folder.id===input.folderId))throw new AppError('目标文件夹不存在');
  const {password:rawPassword,hasPassword:_hasPassword,id:_id,version:_version,path:_path,...fields}=input;
  const passwordHash=fields.access==='password'?(rawPassword?hashPassword(rawPassword):previous?.document.passwordHash||article.passwordHash):undefined;
  const document={...fields,status:article.status,...(passwordHash?{passwordHash}:{})};
  const draft:EditorDraft={articleId:id,baseVersion:article.version,draftVersion:randomUUID(),savedAt:new Date().toISOString(),document,baseDocument:previous?.baseDocument||{...articleMeta(article),body:article.body,folderId:article.folderId}};
  if(previous&&JSON.stringify(previous.document)===JSON.stringify(document))return {article,draft:previous};
  atomicWrite(draftPath(id),JSON.stringify(draft,null,2)+'\n');return {article,draft};
}
export function pushEditorDraft(id:string,tokens:DraftTokens){
  assertLibraryWritable();
  const article=findArticle(id),draft=readEditorDraft(id);
  if(!article||!draft)throw new AppError('请先保存编辑稿',404);
  checkVersions(article,draft,tokens);
  const {passwordHash,...document}=draft.document;
  if(!document.title.trim())throw new AppError('发布前请填写文章标题');
  if(document.access==='password'&&!passwordHash)throw new AppError('发布前请设置访问密码');
  const published=saveArticle({...document,id,version:article.version,status:'published'},{policy:{access:document.access||'inherit',...(passwordHash?{passwordHash}:{})}});
  fs.unlinkSync(draftPath(id));return published;
}
export function unpublishWithEditorDraft(id:string,tokens:DraftTokens){
  assertLibraryWritable();
  const article=findArticle(id),draft=readEditorDraft(id);
  if(!article||!draft)throw new AppError('文章不存在',404);
  checkVersions(article,draft,tokens);
  const next=saveArticle({...article,status:'draft'});
  const updated={...draft,baseVersion:next.version,draftVersion:randomUUID(),document:{...draft.document,status:'draft' as const}};
  atomicWrite(draftPath(id),JSON.stringify(updated));return {article:next,draft:updated};
}

import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from './model';
import {articleMeta,atomicWrite,findArticle,listFolders,saveArticle,applyPolicy} from './storage';
import {readEditorDraft,saveEditorDraft,pushEditorDraft,unpublishWithEditorDraft} from './editor-drafts';
import {libraryPath} from './library-context';
import {siteMutation} from './site-mutations';

export const batchSchema=z.object({
  action:z.enum(['move','access','publish','unpublish']),
  articles:z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),baseVersion:z.string(),draftVersion:z.string().nullable()})).min(1),
  folderId:z.string().optional(),access:z.enum(['inherit','public','private','password']).optional(),password:z.string().max(1024).optional()
});
export type ArticleBatch=z.infer<typeof batchSchema>;

export async function batchArticles(input:ArticleBatch){
  return siteMutation(()=>{
    const ids=new Set<string>();
    const selected=input.articles.map(item=>{
      if(ids.has(item.id))throw new AppError('批量选择中包含重复文章');ids.add(item.id);
      const article=findArticle(item.id),draft=readEditorDraft(item.id);
      if(!article||article.kind!=='post')throw new AppError('文章不存在或已移入回收站：'+item.id,409);
      if(article.version!==item.baseVersion||(draft?.draftVersion||null)!==item.draftVersion||draft&&draft.baseVersion!==article.version)
        throw new AppError('「'+article.title+'」已在其他窗口修改，请刷新列表后重试；本批次未作更改',409);
      return {article,draft};
    });
    if(input.action==='move'&&!listFolders().some(folder=>folder.id===input.folderId))throw new AppError('请选择有效的目标文件夹');
    if(input.action==='access'&&(!input.access||input.access==='password'&&!input.password?.trim()))throw new AppError('请选择权限；密码保护需要填写统一的新密码');
    let changed=0,skipped=0;
    for(const {article,draft} of selected){
      if(input.action==='move'||input.action==='access'){
        const policy=input.action==='access'?applyPolicy({access:input.access,password:input.password},article):undefined;
        const patch=input.action==='move'?{folderId:input.folderId!}:policy!;
        const updated=saveArticle({...article,...patch},{policy:policy||{access:article.access,passwordHash:article.passwordHash}});
        if(draft){
          const document={...draft.document,...patch};delete (document as Record<string,unknown>).passwordHash;
          if((policy||draft.document).access==='password')document.passwordHash=policy?.passwordHash||draft.document.passwordHash;
          atomicWrite(libraryPath('editor-drafts',article.id+'.json'),JSON.stringify({...draft,baseVersion:updated.version,draftVersion:randomUUID(),savedAt:new Date().toISOString(),baseDocument:{...articleMeta(updated),body:updated.body,folderId:updated.folderId},document}));
        }
        changed++;continue;
      }
      if(input.action==='publish'&&article.status==='published'&&!draft||input.action==='unpublish'&&article.status==='draft'){skipped++;continue;}
      const saved=draft||saveEditorDraft(article.id,{...articleMeta(article),body:article.body,folderId:article.folderId},{baseVersion:article.version,draftVersion:null}).draft;
      const tokens={baseVersion:saved.baseVersion,draftVersion:saved.draftVersion};
      if(input.action==='publish')pushEditorDraft(article.id,tokens);else unpublishWithEditorDraft(article.id,tokens);
      changed++;
    }
    return {changed,skipped};
  });
}

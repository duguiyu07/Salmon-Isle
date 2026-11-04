import fs from 'node:fs';
import path from 'node:path';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { findArticle,listArticles,listFolders,saveArticle,saveFolder,trashItem,restoreItem,listTrash,getSettings,saveSettings,reindex,atomicWrite,searchIndex } from '@/lib/storage';
import { adminHash,ADMIN_COOKIE,cookieOptions,createAdminSession,getViewer,grantAccess,requireAdmin } from '@/lib/auth';
import { verifyPassword,hashPassword,digest } from '@/lib/crypto';
import { db,throttle,audit } from '@/lib/db';
import { AppError,defaultSettings } from '@/lib/model';
import { visibility,canRead,publicArticle } from '@/lib/access';
import { dataDir,initDirs,within } from '@/lib/paths';
import { addMedia,getMedia,referencedMediaIds,listMedia,queryMedia,mediaUrl,mediaReferences,deleteMedia } from '@/lib/media';
import {programInfo,programUpdateStatus,checkProgramUpdates,saveProgramUpdateSettings} from '@/lib/application-updates';
import type {ImportAnalysis} from '@/lib/wordpress';
import { sameOrigin,jsonBody,fail,ok } from '@/lib/http';
import {readEditorDraft,clientEditorDraft,listEditorDrafts,saveEditorDraft,pushEditorDraft,unpublishWithEditorDraft} from '@/lib/editor-drafts';
import {workspacePreviewUrls} from '@/lib/workspace-media-url';
import {withWorkspace,withPublicLibrary,libraryPath,activeRevision} from '@/lib/library-context';
import {withRepositoryLock} from '@/lib/repository-lock';
import {siteMutation,draftPaths} from '@/lib/site-mutations';
import {batchArticles,batchSchema} from '@/lib/article-batch';
import {mediaCacheHeaders,mediaNotModified} from '@/lib/media-cache';
export const runtime='nodejs';export const dynamic='force-dynamic';
type Context={params:Promise<{segments:string[]}>};
const articleSchema=z.object({id:z.string().optional(),title:z.string().min(1).max(500),body:z.string().max(10*1024*1024),folderId:z.string().optional(),version:z.string().optional(),kind:z.enum(['post','page']).optional(),contentFormat:z.enum(['markdown','html']).optional(),css:z.string().max(1024*1024).optional(),route:z.string().max(1000).optional(),template:z.enum(['standard','collection']).optional(),collection:z.object({folderId:z.string(),perPage:z.number().int().min(1).max(50)}).optional(),status:z.enum(['draft','published']).optional(),summary:z.string().max(5000).optional(),cover:z.string().max(2000).optional(),pinned:z.boolean().optional(),order:z.number().optional(),access:z.enum(['inherit','public','private','password']).optional(),password:z.string().max(1024).optional(),aliases:z.array(z.string()).optional(),giscusTerm:z.string().max(1000).optional(),tags:z.array(z.string()).optional()});
const folderSchema=z.object({id:z.string().optional(),name:z.string().min(1).max(100),parentId:z.string().optional(),order:z.number().optional(),access:z.enum(['inherit','public','private','password']).optional(),password:z.string().max(1024).optional()});
const draftTokens=z.object({baseVersion:z.string().nullable(),draftVersion:z.string().nullable()});
const editorDraftSchema=draftTokens.extend({articleId:z.string().min(1).max(100),document:articleSchema.extend({title:z.string().max(500),folderId:z.string().default('root'),hasPassword:z.boolean().optional()})});
function validate<T>(schema:z.ZodType<T>,input:unknown):T{const parsed=schema.safeParse(input);if(!parsed.success)throw new AppError(parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('；'));return parsed.data;}
function clientArticle(a:ReturnType<typeof listArticles>[number]){const{passwordHash,...safe}=a;return{...safe,hasPassword:!!passwordHash};}
function articleSummary(a:ReturnType<typeof listArticles>[number]){const {body:_body,css:_css,...summary}=clientArticle(a);return summary;}
function clientFolder(f:ReturnType<typeof listFolders>[number]){const{passwordHash,...safe}=f;return{...safe,hasPassword:!!passwordHash};}
function importDir(id:string){if(!/^[a-f0-9]{32}$/.test(id))throw new AppError('无效导入任务');return within(path.join(dataDir(),'imports'),id);}
function analysisFor(id:string){return JSON.parse(fs.readFileSync(path.join(importDir(id),'analysis.json'),'utf8')) as ImportAnalysis;}

async function getHandler(request:Request,context:Context){try{
  const {segments:s}=await context.params;
  if(s[0]==='health')return ok({status:'ok',contentRevision:activeRevision()});
  if(s[0]==='program-info')return Response.json(programInfo(),{headers:{'Cache-Control':'public, max-age=60','Access-Control-Allow-Origin':'*'}});
  if(s[0]==='media'&&s[1]){
    const media=getMedia(s[1]);if(!media)throw new AppError('附件不存在',404);
    const viewer=await getViewer();
    if(!viewer.admin){const articleId=new URL(request.url).searchParams.get('article')||media.owner,article=findArticle(articleId);
      const referenced=article&&(article.body.includes(`/api/media/${media.id}?article=${encodeURIComponent(article.id)}`)||article.cover===mediaUrl(media.id,article.id)||article.kind==='page'&&article.css?.includes(mediaUrl(media.id,article.id)));
      if(!article||!referenced||!canRead(article,viewer))throw new AppError('附件不存在或无权访问',404);
    }
    const file=within(libraryPath('media'),media.id);if(!fs.existsSync(file))throw new AppError('附件文件丢失',404);
    const stat=fs.statSync(file,{bigint:true}),cache=mediaCacheHeaders(file,stat);
    if(mediaNotModified(request,cache))return new Response(null,{status:304,headers:cache});
    return new Response(fs.readFileSync(file),{headers:{...cache,'Content-Type':media.type,'Content-Length':String(stat.size),'Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':`${media.type.startsWith('image/')?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(media.name)}`}});
  }
  if(s[0]==='search'){
    const q=(new URL(request.url).searchParams.get('q')||'').trim().slice(0,200).toLowerCase();const viewer=await getViewer();const folders=listFolders();
    const matches=q?searchIndex(q):new Set<string>();const results=listArticles().filter(a=>a.kind==='post'&&a.status==='published'&&(!q||a.title.toLowerCase().includes(q)||(!visibility(a,folders).restricted&&matches.has(a.id)))).map(a=>publicArticle(a,viewer,folders)).filter(Boolean);return ok({results});
  }
  if(s[0]!=='admin')throw new AppError('接口不存在',404);await requireAdmin();
  if(s[1]==='backup')return await withRepositoryLock(async()=>new Response(new Uint8Array((await import('@/lib/backup')).backupData()),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="salmon-isle-backup.zip"','Cache-Control':'private, no-store'}}));
  if(s[1]==='program-updates')return ok(new URL(request.url).searchParams.get('check')==='1'?await checkProgramUpdates():programUpdateStatus());
  if(['git','sync'].includes(s[1]))throw new AppError('桌面同步已停用，请在网站后台编辑',410);
  if(s[1]==='media'){const query=new URL(request.url).searchParams;return ok(s[2]?mediaReferences(s[2]):queryMedia({q:query.get('q')||'',type:query.get('type')||'all',usage:query.get('usage')||'all',page:Number(query.get('page'))||1}));}
  if(s[1]==='state'){const articles=listArticles();return ok({articles:articles.filter(a=>a.kind==='post').map(articleSummary),pages:articles.filter(a=>a.kind==='page').map(articleSummary),editorDrafts:listEditorDrafts(articles),folders:listFolders().map(clientFolder),settings:getSettings(),trash:listTrash()});}
  if(s[1]==='editor-drafts'&&s[2]){
    const article=findArticle(s[2]);if(!article)throw new AppError('文章不存在',404);
    const draft=readEditorDraft(article.id);
    return ok({article:clientArticle(article),draft:draft?clientEditorDraft(draft):null});
  }
  if(s[1]==='audit')return ok(db().prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all());
  if(s[1]==='export'){
    const {zipSync,strToU8}=await import('fflate');
    const entries:Record<string,Uint8Array>={};
    for(const a of listArticles()){
      let markdown=fs.readFileSync(within(libraryPath('content'),a.path),'utf8');
      for(const m of listMedia()){const exported=`media/${m.id}-${m.name}`;const relative=path.posix.relative(path.posix.dirname(`content/${a.path}`),exported);markdown=markdown.split(mediaUrl(m.id,a.id)).join(relative);}
      entries[`content/${a.path}`]=strToU8(markdown);
    }
    for(const f of listFolders().filter(f=>f.id!=='root')){const file=within(libraryPath('content'),`${f.path}/.folder.yml`);if(fs.existsSync(file))entries[`content/${f.path}/.folder.yml`]=fs.readFileSync(file);}
    for(const m of listMedia()){const file=within(libraryPath('media'),m.id);if(fs.existsSync(file))entries[`media/${m.id}-${m.name}`]=fs.readFileSync(file);}
    return new Response(Buffer.from(zipSync(entries)),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="salmon-isle-markdown.zip"','Cache-Control':'no-store'}});
  }
  if(s[1]==='imports'&&s[2]&&s[3]==='download')return new Response(Buffer.from((await import('@/lib/wordpress')).convertedZip(analysisFor(s[2]))),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="wordpress-converted.zip"','Cache-Control':'no-store'}});
  throw new AppError('接口不存在',404);
}catch(e){return fail(e);}}

async function postHandler(request:Request,context:Context){try{
  sameOrigin(request);const{segments:s}=await context.params;
  if(s[0]==='setup'){
    if(adminHash())throw new AppError('后台已配置',409);const input=validate(z.object({token:z.string(),password:z.string().min(12).max(1024)}),await jsonBody(request));
    if(!throttle('setup',5))throw new AppError('尝试过多，请稍后重试',429);
    const file=path.join(dataDir(),'setup-token');if(!fs.existsSync(file)||digest(input.token)!==digest(fs.readFileSync(file,'utf8').trim()))throw new AppError('初始化令牌错误；请先在终端运行 npm run setup',403);
    atomicWrite(path.join(dataDir(),'admin.json'),JSON.stringify({hash:hashPassword(input.password)}));fs.unlinkSync(file);await createAdminSession();return ok({success:true});
  }
  if(s[0]==='login'){
    const input=validate(z.object({password:z.string().max(1024)}),await jsonBody(request));
    if(!throttle('admin-login',12))throw new AppError('尝试过多，请 15 分钟后重试',429);
    if(!verifyPassword(input.password,adminHash()))throw new AppError('管理密码不正确',401);
    await createAdminSession();audit('admin.login','admin');return ok({success:true});
  }
  if(s[0]==='logout'){const jar=await cookies();const value=jar.get(ADMIN_COOKIE)?.value;if(value)db().prepare('DELETE FROM sessions WHERE id=?').run(digest(value));jar.set(ADMIN_COOKIE,'',cookieOptions(0));return ok({success:true});}
  if(s[0]==='unlock'){
    const input=validate(z.object({articleId:z.string(),gateId:z.string(),password:z.string().max(1024)}),await jsonBody(request));const article=findArticle(input.articleId);if(!article)throw new AppError('文章不存在',404);
    const rule=visibility(article);if(rule.hidden)throw new AppError('文章不存在',404);const gate=rule.gates.find(g=>g.id===input.gateId);if(!gate)throw new AppError('该内容不需要这个密码');
    if(!throttle(`unlock:${gate.id}`,20))throw new AppError('尝试过多，请稍后重试',429);
    if(!verifyPassword(input.password,gate.hash))throw new AppError('访问密码不正确',401);await grantAccess(gate.id,gate.fingerprint);return ok({success:true});
  }
  if(s[0]!=='admin')throw new AppError('接口不存在',404);await requireAdmin();
  if(s[1]==='program-updates'){const input=validate(z.object({manifestUrl:z.string().max(2000)}),await jsonBody(request));return ok(saveProgramUpdateSettings(input.manifestUrl));}
  if(['git','sync'].includes(s[1]))throw new AppError('桌面同步已停用，请在网站后台编辑',410);
  if(s[1]==='articles'&&s[2]==='batch')return ok(await batchArticles(validate(batchSchema,await jsonBody(request))));
  if(s[1]==='editor-drafts'){
    if(s[2]&&s[3]==='push')return ok(clientArticle(pushEditorDraft(s[2],validate(draftTokens,await jsonBody(request)))));
    if(s[2]&&s[3]==='unpublish'){
      const result=unpublishWithEditorDraft(s[2],validate(draftTokens,await jsonBody(request)));
      return ok({article:clientArticle(result.article),draft:clientEditorDraft(result.draft)});
    }
    if(!s[2]){
      const input=validate(editorDraftSchema,await jsonBody(request));
      const result=await siteMutation(()=>{const result=saveEditorDraft(input.articleId,input.document,input);for(const id of referencedMediaIds(result.draft.document))if(!getMedia(id))throw new AppError('编辑稿引用的附件不存在');return result;},draftPaths(input.articleId,input.document));
      return ok({article:clientArticle(result.article),draft:clientEditorDraft(result.draft)});
    }
    throw new AppError('接口不存在',404);
  }
  if(s[1]==='articles'){const input=validate(articleSchema,await jsonBody(request));if(input.kind==='page'||input.id&&findArticle(input.id)?.kind==='page')throw new AppError('请使用页面编辑器保存页面');return ok(clientArticle(saveArticle({...input,kind:'post'})));}
  if(s[1]==='pages'&&s[2]==='preview'){const input=validate(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),body:z.string().max(10*1024*1024),css:z.string().max(1024*1024).optional(),route:z.string().optional(),collection:z.object({folderId:z.string(),perPage:z.number()}).optional()}),await jsonBody(request));const rendered=await (await import('@/lib/html-pages')).renderHtmlPage(input,await getViewer());return ok({...rendered,html:workspacePreviewUrls(rendered.html),css:workspacePreviewUrls(rendered.css)});}
  if(s[1]==='pages'&&s[2]==='convert'){const input=validate(z.object({id:z.string()}),await jsonBody(request)),page=findArticle(input.id);if(!page||page.kind!=='page')throw new AppError('页面不存在',404);return ok(clientArticle(await (await import('@/lib/page-migration')).convertLegacyPage(page)));}
  if(s[1]==='folders')return ok(clientFolder(saveFolder(validate(folderSchema,await jsonBody(request)))));
  if(s[1]==='trash'){const input=validate(z.object({id:z.string(),kind:z.enum(['article','folder'])}),await jsonBody(request));return ok(trashItem(input.id,input.kind));}
  if(s[1]==='restore'){const input=validate(z.object({id:z.string()}),await jsonBody(request));restoreItem(input.id);await (await import('@/lib/page-migration')).convertLegacyPages();return ok({success:true});}
  if(s[1]==='reindex')return ok({count:reindex()});
  if(s[1]==='preview'){const input=validate(z.object({body:z.string().max(10*1024*1024)}),await jsonBody(request));const rendered=await (await import('@/lib/markdown')).renderMarkdown(input.body);return ok({...rendered,html:workspacePreviewUrls(rendered.html)});}
  if(s[1]==='settings'){
    const input=await jsonBody(request);const schema=z.object({title:z.string().max(200),subtitle:z.string().max(200),email:z.string().max(200),logo:z.string().max(2000),description:z.string().max(2000),footer:z.string().max(500),navigation:z.array(z.object({label:z.string().max(50),href:z.string().max(1000)})).max(12),homeFolders:z.array(z.string()),knowledgeRootId:z.string().optional(),giscus:z.object({repo:z.string().max(200),repoId:z.string().max(100),category:z.string().max(100),categoryId:z.string().max(100),enabled:z.boolean()})});
    return ok(saveSettings(validate(schema,{...defaultSettings,...input})));
  }
  if(s[1]==='media'){
    const form=await request.formData();const file=form.get('file');const owner=String(form.get('articleId')||'');if(!(file instanceof File)||owner&&!findArticle(owner))throw new AppError('请选择文件，或先保存对应文章');
    if(file.size>40*1024*1024)throw new AppError('附件不能超过 40MB',413);const media=addMedia(file.name,Buffer.from(await file.arrayBuffer()),owner);return ok({...media,url:mediaUrl(media.id,owner)});
  }
  if(s[1]==='imports'&&!s[2]){
    const {analyzeWordPress,redactImportXml}=await import('@/lib/wordpress');
    const form=await request.formData();const xml=form.get('xml');const zip=form.get('media');if(!(xml instanceof File))throw new AppError('请选择 XML 文件');
    if(xml.size>50*1024*1024)throw new AppError('XML 不能超过 50MB',413);if(zip instanceof File&&zip.size>256*1024*1024)throw new AppError('媒体包不能超过 256MB',413);
    const analysis=analyzeWordPress(await xml.text(),String(form.get('profile')||'')||undefined);const id=digest(crypto.randomUUID()).slice(0,32);const dir=importDir(id);fs.mkdirSync(dir,{recursive:true});
    atomicWrite(path.join(dir,'analysis.json'),JSON.stringify(analysis));atomicWrite(path.join(dir,'source.xml'),redactImportXml(await xml.text()));if(zip instanceof File&&zip.size)atomicWrite(path.join(dir,'media.zip'),Buffer.from(await zip.arrayBuffer()));
    return ok({id,...analysis,candidates:analysis.candidates.map(c=>({...c,meta:{...c.meta,passwordHash:undefined,hasPassword:!!c.meta.passwordHash}}))});
  }
  if(s[1]==='imports'&&s[2]&&s[3]==='profile'){
    const {analyzeWordPress}=await import('@/lib/wordpress');
    const input=validate(z.object({profileId:z.string()}),await jsonBody(request));const dir=importDir(s[2]);const previous=analysisFor(s[2]);const analysis=analyzeWordPress(fs.readFileSync(path.join(dir,'source.xml'),'utf8'),input.profileId);for(const c of analysis.candidates){const old=previous.candidates.find(p=>p.meta.id===c.meta.id);if(old){c.meta.access=old.meta.access;c.meta.passwordHash=old.meta.passwordHash;}}atomicWrite(path.join(dir,'analysis.json'),JSON.stringify(analysis));return ok({id:s[2],...analysis,candidates:analysis.candidates.map(c=>({...c,meta:{...c.meta,passwordHash:undefined,hasPassword:!!c.meta.passwordHash}}))});
  }
  if(s[1]==='imports'&&s[2]&&s[3]==='commit'){
    const {commitImport}=await import('@/lib/wordpress');
    const input=validate(z.object({choices:z.array(z.object({id:z.string(),selected:z.boolean(),folder:z.string().optional(),update:z.boolean().optional()})),rootFolder:z.string().optional()}),await jsonBody(request));const zip=path.join(importDir(s[2]),'media.zip');
    const result=commitImport(analysisFor(s[2]),input.choices,{rootFolder:input.rootFolder,zip:fs.existsSync(zip)?fs.readFileSync(zip):undefined});await (await import('@/lib/page-migration')).convertLegacyPages(result.ids);return ok(result);
  }
  throw new AppError('接口不存在',404);
}catch(e){throw e;}}

export async function GET(request:Request,context:Context){
  const {segments}=await context.params;
  if(segments[0]==='media'&&new URL(request.url).searchParams.get('workspace')==='1'){
    try{await requireAdmin();return withWorkspace(()=>getHandler(request,context));}catch(error){return fail(error);}
  }
  return segments[0]==='admin'?withWorkspace(()=>getHandler(request,context)):withPublicLibrary(()=>getHandler(request,context));
}
export async function POST(request:Request,context:Context){
  const {segments}=await context.params;
  if(segments[0]==='github')return fail(new AppError('内容 Git 同步已停用',410));
  if(segments[0]!=='admin'){try{return await withPublicLibrary(()=>postHandler(request,context));}catch(error){return fail(error);}}
  try{await requireAdmin();
    if(segments[1]==='articles'&&segments[2]==='batch'||segments[1]==='editor-drafts'&&!segments[2])return await withWorkspace(()=>postHandler(request,context));
    const mutate=['articles','pages','editor-drafts','folders','trash','restore','media','imports'].includes(segments[1])&&segments[2]!=='preview';
    return mutate?await siteMutation(()=>postHandler(request,context)):await withWorkspace(()=>withRepositoryLock(()=>postHandler(request,context)));}catch(error){return fail(error);}
}
export async function DELETE(request:Request,context:Context){try{
  sameOrigin(request);await requireAdmin();const {segments}=await context.params;
  if(segments[0]!=='admin'||segments[1]!=='media'||!segments[2])throw new AppError('接口不存在',404);
  const input=request.body?validate(z.object({forceTrashReferences:z.boolean().optional()}),await jsonBody(request)):{forceTrashReferences:false};
  return await siteMutation(()=>ok(deleteMedia(segments[2],input.forceTrashReferences)));
}catch(error){return fail(error);}}

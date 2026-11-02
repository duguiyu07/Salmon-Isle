import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import YAML from 'yaml';
import postcss from 'postcss';
import {AppError} from './model';
import {withLibrary,libraryRoot,libraryPath} from './library-context';
import {listArticles,listFolders,splitMarkdown} from './storage';
import {listMedia,mediaTypes,referencedMediaIds,sanitizeSvg} from './media';
import {normalizePageRoute} from './page-routes';

export const libraryDirectories=['content','media','media-meta','editor-drafts','trash'] as const;
export function managedPath(file:string){return file==='library.json'||file==='.gitignore'||file==='.gitattributes'||file==='README.md'||libraryDirectories.some(dir=>file.startsWith(dir+'/'));}
export function validatePortablePath(file:string){
  if(!file||file.startsWith('/')||file.includes('\\')||file.includes('\0'))throw new AppError('非法内容路径：'+file);
  for(const part of file.split('/'))if(!part||part==='.'||part==='..'||/[<>:"|?*\x00-\x1f]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part))throw new AppError('路径不兼容 Windows：'+file);
}
export function libraryFiles(root:string){
  const files:string[]=[],seen=new Set<string>();let size=0;
  function visit(dir:string){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(entry.name==='.git'&&dir===root)continue;
    const absolute=path.join(dir,entry.name),relative=path.relative(root,absolute).split(path.sep).join('/');
    validatePortablePath(relative);if(entry.isSymbolicLink())throw new AppError('内容库不允许符号链接：'+relative);
    const key=relative.normalize('NFC').toLowerCase();if(seen.has(key))throw new AppError('大小写或 Unicode 重复路径：'+relative);seen.add(key);
    if(entry.isDirectory()){if(!libraryDirectories.includes(relative.split('/')[0] as any))throw new AppError('内容库包含未管理目录：'+relative);visit(absolute);}
    else {if(!managedPath(relative))throw new AppError('内容库包含未管理文件：'+relative);const length=fs.statSync(absolute).size;size+=length;if(length>41*1024*1024||size>2*1024*1024*1024)throw new AppError('内容库文件过大');files.push(relative);}
  }}visit(root);return files;
}
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const policy=z.object({access:z.enum(['public','private','password','inherit']),passwordHash:z.string().optional()}).passthrough();
const metadata=z.object({id,name:z.string().min(1),type:z.string(),size:z.number().int().nonnegative().max(40*1024*1024),owner:z.string(),source:z.string().nullable().optional(),createdAt:z.string().optional()}).passthrough();
function checked<T>(schema:z.ZodType<T>,value:unknown,file:string):T{const result=schema.safeParse(value);if(!result.success)throw new AppError('内容格式错误：'+file+'：'+result.error.issues.map(issue=>issue.path.join('.')+' '+issue.message).join('；'));return result.data;}
export function validateLibrary(root:string){return withLibrary(root,()=>{
  const files=libraryFiles(root);const marker=JSON.parse(fs.readFileSync(path.join(root,'library.json'),'utf8'));
  if(marker.version!==1)throw new AppError('不支持的内容仓库版本');
  const articles=listArticles(),folders=listFolders(),folderIds=new Set<string>(),articleIds=new Set(articles.map(a=>a.id));
  for(const folder of folders){if(folderIds.has(folder.id))throw new AppError('重复文件夹 ID：'+folder.id);folderIds.add(folder.id);checked(id,folder.id,folder.path);const p=checked(policy,folder,folder.path);if(p.access==='password'&&!p.passwordHash)throw new AppError('文件夹缺少密码散列：'+folder.name);}
  const draftFolderIds=new Set(folderIds);
  for(const file of files.filter(file=>file.startsWith('trash/')&&path.posix.basename(file)==='.folder.yml')){const folder=YAML.parse(fs.readFileSync(path.join(root,file),'utf8'),{maxAliasCount:0});checked(id,folder?.id,file);draftFolderIds.add(folder.id);}
  const routes=new Map<string,string>();
  for(const article of articles){
    const raw=splitMarkdown(fs.readFileSync(libraryPath('content',article.path),'utf8')).meta;
    checked(z.object({id,status:z.enum(['draft','published']),kind:z.enum(['post','page']),title:z.string(),body:z.string().optional()}).passthrough(),raw,article.path);
    const p=checked(policy,raw,article.path);if(p.access==='password'&&!p.passwordHash)throw new AppError('文章缺少密码散列：'+article.title);
    if(article.body.length>10*1024*1024)throw new AppError('文章过大：'+article.title);
    if(article.kind==='page'){
      if(article.status==='published'&&article.contentFormat==='html'){if(!normalizePageRoute(article.route||''))throw new AppError('页面地址无效：'+article.title);try{postcss.parse(article.css||'');}catch{throw new AppError('页面 CSS 无效：'+article.title);}}
      for(const route of [article.route,...article.aliases].filter(Boolean) as string[]){const key=route.split('?')[0];if(routes.has(key)&&routes.get(key)!==article.id)throw new AppError('页面地址重复：'+key);routes.set(key,article.id);}
    }
    if(article.collection&&!folderIds.has(article.collection.folderId))throw new AppError('集合引用了不存在的文件夹：'+article.title);
  }
  const media=listMedia(),mediaIds=new Set<string>();
  for(const file of files.filter(file=>file.startsWith('media-meta/'))){const m=checked(metadata,JSON.parse(fs.readFileSync(path.join(root,file),'utf8')),file);if(file!==`media-meta/${m.id}.json`||mediaIds.has(m.id))throw new AppError('媒体 ID 不一致：'+file);mediaIds.add(m.id);const asset=path.join(root,'media',m.id);if(!fs.existsSync(asset)||fs.statSync(asset).size!==m.size||mediaTypes[path.extname(m.name).toLowerCase()]!==m.type)throw new AppError('媒体文件或类型不一致：'+m.name);if(m.type==='image/svg+xml'){const bytes=fs.readFileSync(asset);if(!sanitizeSvg(bytes).equals(bytes))throw new AppError('SVG 必须先通过上传接口清理：'+m.name);}}
  for(const file of files.filter(file=>file.startsWith('media/')))if(!mediaIds.has(file.slice(6)))throw new AppError('媒体缺少元数据：'+file);
  for(const file of files){
    if(file.startsWith('media/')||file.startsWith('media-meta/'))continue;
    let value:unknown;
    if(file.endsWith('.json')){value=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));if(file.startsWith('editor-drafts/')){const draft=checked(z.object({articleId:id,baseVersion:z.string(),draftVersion:z.string(),document:z.object({title:z.string(),body:z.string(),folderId:z.string()}).passthrough()}).passthrough(),value,file);if(!draftFolderIds.has(draft.document.folderId))throw new AppError('编辑稿目标文件夹不存在：'+file);}}
    else if(file.endsWith('.md')||file.startsWith('trash/')&&path.posix.basename(file)==='content'){try{value=splitMarkdown(fs.readFileSync(path.join(root,file),'utf8'));}catch{continue;}}
    else if(file.endsWith('.yml'))value=YAML.parse(fs.readFileSync(path.join(root,file),'utf8'),{maxAliasCount:0});
    else continue;
    const text=JSON.stringify(value);if(/"password"\s*:/.test(text))throw new AppError('内容库不允许明文密码：'+file);
    for(const ref of referencedMediaIds(value))if(!mediaIds.has(ref))throw new AppError('引用的媒体不存在：'+ref+'（'+file+'）');
  }
  return {articles:articles.length,folders:folders.length-1,media:media.length,drafts:files.filter(file=>file.startsWith('editor-drafts/')).length,files:files.length};
});}

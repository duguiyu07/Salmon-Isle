import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { dataDir, initDirs,within } from './paths';
import { AppError } from './model';
import { atomicWrite,listArticles,splitMarkdown } from './storage';
import { load } from 'cheerio';
import YAML from 'yaml';
import {digest} from './crypto';
import {libraryTransaction} from './library-transaction';
import {mediaReferences,mediaReferenceIndex,referenceFiles,readReferenceFile,replaceMediaReference,invalidateMediaReferences,referencedMediaIds} from './media-references';
import {libraryRoot,libraryPath,assertLibraryWritable} from './library-context';
import type {Media,MediaPage,MediaUsage} from './media-model';
export type {Media,MediaReference} from './media-model';
export {mediaReferences,referencedMediaIds} from './media-references';
export const mediaTypes:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif','.svg':'image/svg+xml','.pdf':'application/pdf','.mp3':'audio/mpeg','.mp4':'video/mp4','.webm':'video/webm','.txt':'text/plain','.zip':'application/zip'};
export function sanitizeSvg(bytes:Buffer){
  const raw=bytes.toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(raw))throw new AppError('SVG 不允许 DTD 或实体声明');
  const $=load(raw,{xmlMode:true});if(!$('svg').length)throw new AppError('SVG 文件无效');$('script,foreignObject,iframe,object,embed,style').remove();
  $('*').each((_,node)=>{if(!('attribs'in node))return;for(const [key,value]of Object.entries(node.attribs))if(/^on/i.test(key)||(/href$/i.test(key)&&!value.startsWith('#'))||key==='style'&&/url\(|expression|@import/i.test(value))$(node).removeAttr(key);});
  return Buffer.from($.xml());
}
export function addMedia(name:string,bytes:Buffer,owner='',source?:string) {
  assertLibraryWritable();
  const ext=path.extname(name).toLowerCase();const type=mediaTypes[ext];
  if (!type) throw new AppError(`不支持的附件类型：${ext || name}`);
  if(bytes.length>40*1024*1024) throw new AppError('附件不能超过 40MB');
  if(ext==='.svg')bytes=sanitizeSvg(bytes);
  initDirs();
  if (source) {const old=listMedia().find(media=>media.source===source);if(old&&fs.existsSync(libraryPath('media',old.id)))return old;}
  const media:Media={id:randomUUID(),name:path.basename(name).replace(/[\r\n"\\]/g,'_'),type,size:bytes.length,owner,createdAt:new Date().toISOString(),...(source?{source}:{})};
  atomicWrite(libraryPath('media',media.id),bytes);writeMediaMetadata(media);return media;
}
export function writeMediaMetadata(media:Media){
  assertLibraryWritable();atomicWrite(within(libraryPath('media-meta'),media.id+'.json'),JSON.stringify(media,null,2)+'\n');
  if(libraryRoot()===dataDir())db().prepare('INSERT OR REPLACE INTO media VALUES(?,?,?,?,?,?)').run(media.id,media.name,media.type,media.size,media.owner,media.source||null);
}
export function getMedia(id:string):Media|undefined{
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))return undefined;
  const file=within(libraryPath('media-meta'),id+'.json');
  if(fs.existsSync(file)){const media=JSON.parse(fs.readFileSync(file,'utf8')) as Media;if(media.id!==id)throw new AppError('媒体元数据 ID 不一致');return media;}
  return libraryRoot()===dataDir()?db().prepare('SELECT * FROM media WHERE id=?').get(id) as unknown as Media|undefined:undefined;
}
export function listMedia():Media[]{
  const rows=new Map<string,Media>();
  if(libraryRoot()===dataDir())for(const media of db().prepare('SELECT * FROM media ORDER BY rowid DESC').all() as unknown as Media[])rows.set(media.id,media);
  const dir=libraryPath('media-meta');if(fs.existsSync(dir))for(const entry of fs.readdirSync(dir))if(entry.endsWith('.json')){const media=JSON.parse(fs.readFileSync(within(dir,entry),'utf8')) as Media;rows.set(media.id,media);}
  return [...rows.values()].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')||a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id));
}
export function mediaUrl(id:string,article:string){return `/api/media/${id}?article=${encodeURIComponent(article)}`;}
export function queryMedia(input:{q?:string;type?:string;usage?:string;page?:number;pageSize?:number}={}):MediaPage{
  const all=listMedia(),index=mediaReferenceIndex(),query=(input.q||'').trim().slice(0,200).toLocaleLowerCase(),type=input.type||'all',usage=(input.usage||'all') as MediaUsage;
  if(!['all','image','audio','video','other'].includes(type)||!['all','unused','trash','active'].includes(usage))throw new AppError('无效的媒体筛选');
  const filtered=all.filter(media=>{
    if(query&&!media.name.toLocaleLowerCase().includes(query))return false;
    if(type==='other'?['image/','audio/','video/'].some(prefix=>media.type.startsWith(prefix)):type!=='all'&&!media.type.startsWith(type+'/'))return false;
    const refs=index.get(media.id)||[],active=refs.some(ref=>ref.kind!=='trash');
    return usage==='all'||usage==='unused'&&!refs.length||usage==='trash'&&!!refs.length&&!active||usage==='active'&&active;
  });
  const pageSize=Math.min(96,Math.max(1,Math.trunc(input.pageSize||24))),pages=Math.max(1,Math.ceil(filtered.length/pageSize)),page=Math.min(pages,Math.max(1,Math.trunc(input.page||1)));
  return {items:filtered.slice((page-1)*pageSize,page*pageSize),total:filtered.length,totalAll:all.length,page,pageSize,pages};
}
export function deleteMedia(id:string,forceTrashReferences=false){
  assertLibraryWritable();const media=getMedia(id);if(!media)throw new AppError('附件不存在',404);
  invalidateMediaReferences();const references=mediaReferences(id);
  if(references.some(ref=>ref.kind!=='trash')||references.length&&!forceTrashReferences)throw new AppError('请先解除以下引用：'+references.map(ref=>ref.title+'（'+ref.field+'，'+(ref.kind==='trash'?'回收站':'有效引用')+'）').join('、'),409);
  const rewrites=new Map<string,string>(),versions=new Map<string,{before:string;after:string}>();
  for(const file of new Set(references.map(ref=>ref.location))){
    const {value,markdown}=readReferenceFile(file),next=replaceMediaReference(value,id) as Record<string,unknown>;
    if(referencedMediaIds(next).has(id))throw new AppError('存在无法安全替换的引用：'+file,409);
    let text:string;
    if(markdown){const {body,...meta}=next;text='---\n'+YAML.stringify(meta,{lineWidth:0})+'---\n'+String(body||'');if(typeof next.id==='string')versions.set(next.id,{before:digest(fs.readFileSync(within(libraryRoot(),file),'utf8')),after:digest(text)});}
    else text=file.endsWith('.yml')?YAML.stringify(next):JSON.stringify({...next,...(next.draftVersion?{draftVersion:randomUUID()}: {})},null,2)+'\n';
    rewrites.set(file,text);
  }
  for(const file of referenceFiles().filter(file=>file.startsWith('editor-drafts/')&&file.endsWith('.json'))){
    const draft=JSON.parse(rewrites.get(file)||fs.readFileSync(within(libraryRoot(),file),'utf8')),version=versions.get(draft.articleId);
    if(version&&draft.baseVersion===version.before){draft.baseVersion=version.after;draft.draftVersion=randomUUID();rewrites.set(file,JSON.stringify(draft,null,2)+'\n');}
  }
  const trashId=randomUUID(),prefix='trash/'+trashId,metadata='media-meta/'+id+'.json';
  return libraryTransaction([...rewrites.keys(),'media/'+id,metadata,prefix+'/manifest.json',prefix+'/content'],()=>{
    for(const [file,text]of rewrites)atomicWrite(within(libraryRoot(),file),text);
    atomicWrite(libraryPath(prefix,'manifest.json'),JSON.stringify({id:trashId,kind:'media',title:media.name,originalPath:'media/'+id,time:new Date().toISOString(),media},null,2)+'\n');
    fs.renameSync(within(libraryPath('media'),id),libraryPath(prefix,'content'));
    const meta=within(libraryRoot(),metadata);if(fs.existsSync(meta))fs.unlinkSync(meta);
    invalidateMediaReferences();if(mediaReferences(id).length)throw new AppError('媒体引用发生变化，已取消删除',409);
    if(libraryRoot()===dataDir())db().prepare('DELETE FROM media WHERE id=?').run(id);return {id:trashId,replaced:references.length};
  });
}

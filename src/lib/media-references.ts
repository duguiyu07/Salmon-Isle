import {staticAsset} from './static-asset';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {digest} from './crypto';
import {libraryRoot,libraryPath} from './library-context';
import {splitMarkdown,normalizeMeta} from './storage';
import {within} from './paths';
import type {Article} from './model';
import {AppError} from './model';
import type {MediaReference} from './media-model';

export const deletedMediaPlaceholder=staticAsset('/media-deleted.svg');
type Fields=Record<string,unknown>;
interface Source {file:string;field:string;document:Fields;value:unknown;id:string;title:string;kind:MediaReference['kind'];trashId?:string}
interface ReferenceIndex {signature:string;sources:Source[];references:Map<string,MediaReference[]>}
const indexes=new Map<string,ReferenceIndex>();
export function referencedMediaIds(value:unknown):Set<string>{
  const ids=new Set<string>();
  const scan=(item:unknown)=>{
    if(typeof item==='string'){
      const decoded=item.replace(/\\\//g,'/').replace(/&#(?:x([a-f0-9]+)|(\d+));/gi,(_,hex,decimal)=>String.fromCodePoint(Math.min(0x10ffff,parseInt(hex||decimal,hex?16:10))));
      for(const match of decoded.matchAll(/\/api\/media\/([a-zA-Z0-9_-]+)/g))ids.add(match[1]);
    }else if(Array.isArray(item))item.forEach(scan);else if(item&&typeof item==='object')Object.values(item).forEach(scan);
  };scan(value);return ids;
}
function referenceKey(source:Source){return digest(source.file+'\0'+source.field).slice(0,32);}
export function referenceFiles(){
  const files:string[]=[];
  const visit=(relative:string)=>{
    const dir=within(libraryRoot(),relative);if(!fs.existsSync(dir))return;
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      if(entry.isSymbolicLink())throw new AppError('媒体引用扫描不允许符号链接');
      const file=relative+'/'+entry.name;
      if(entry.isDirectory())visit(file);
      else if(/\.(md|json|yml)$/.test(entry.name)||entry.name==='content'){
        if(relative.startsWith('trash/')){
          const manifest=libraryPath('trash',relative.split('/')[1],'manifest.json');
          if(fs.existsSync(manifest)&&JSON.parse(fs.readFileSync(manifest,'utf8')).kind==='media')continue;
        }
        files.push(file);
      }
    }
  };
  for(const dir of ['content','editor-drafts','trash'])visit(dir);
  return files.sort();
}
export function readReferenceFile(file:string):{value:Fields;markdown:boolean}{
  const raw=fs.readFileSync(within(libraryRoot(),file),'utf8');
  try{
    if(file.endsWith('.json'))return {value:JSON.parse(raw),markdown:false};
    if(file.endsWith('.yml'))return {value:YAML.parse(raw,{maxAliasCount:0})||{},markdown:false};
    const parsed=splitMarkdown(raw);return {value:{...parsed.meta,body:parsed.body},markdown:true};
  }catch{throw new AppError('无法检查媒体引用，文件格式无效：'+file,409);}
}
function buildIndex():ReferenceIndex{
  const root=libraryRoot(),files=referenceFiles();
  const signature=digest(files.map(file=>{const stat=fs.statSync(within(root,file),{bigint:true});return file+':'+stat.size+':'+stat.mtimeNs+':'+stat.ctimeNs;}).join('\n'));
  const cached=indexes.get(root);if(cached?.signature===signature)return cached;
  const loaded=files.map(file=>({file,...readReferenceFile(file)}));
  const trashedIds=new Map<string,string>();
  for(const item of loaded)if(item.file.startsWith('trash/')&&item.markdown&&typeof item.value.id==='string')trashedIds.set(item.value.id,item.file.split('/')[1]);
  const sources:Source[]=[];
  for(const {file,value} of loaded){
    const id=String(value.articleId||value.id||path.posix.basename(file)),trashId=file.startsWith('trash/')?file.split('/')[1]:trashedIds.get(id);
    const kind:MediaReference['kind']=trashId?'trash':file.startsWith('editor-drafts/')?'draft':'article';
    const add=(document:Fields,prefix='')=>{
      const title=String(document.title||value.title||'未命名内容');
      for(const [field,label] of [['body','正文'],['cover','封面'],['css','CSS']] as const)if(referencedMediaIds(document[field]).size)sources.push({file,field:prefix+label,document,value:document[field],id,title,kind,trashId});
      const other=Object.fromEntries(Object.entries(document).filter(([key])=>!['body','cover','css','document','baseDocument'].includes(key)));
      if(referencedMediaIds(other).size)sources.push({file,field:prefix+'元数据',document,value:other,id,title,kind,trashId});
    };
    if(value.document&&typeof value.document==='object')add(value.document as Fields,'编辑稿 · ');
    else add(value);
    if(value.baseDocument&&typeof value.baseDocument==='object')add(value.baseDocument as Fields,'合并基线 · ');
  }
  const references=new Map<string,MediaReference[]>();
  for(const source of sources){
    const ref:MediaReference={id:source.id,title:source.title,location:source.file,kind:source.kind,field:source.field,href:'/admin/reference/'+referenceKey(source),...(source.trashId?{trashId:source.trashId}:{})};
    for(const id of referencedMediaIds(source.value)){const rows=references.get(id)||[];rows.push(ref);references.set(id,rows);}
  }
  const result={signature,sources,references};if(indexes.size>=8)indexes.delete(indexes.keys().next().value!);indexes.set(root,result);return result;
}
export function mediaReferenceIndex(){return buildIndex().references;}
export function invalidateMediaReferences(){indexes.delete(libraryRoot());}
export function mediaReferences(id:string){return mediaReferenceIndex().get(id)||[];}
export function mediaReferenceDocument(key:string):{article:Article;field:string;kind:MediaReference['kind']}|null{
  if(!/^[a-f0-9]{32}$/.test(key))return null;
  const source=buildIndex().sources.find(source=>referenceKey(source)===key);if(!source)return null;
  return {article:{...normalizeMeta(source.document),id:source.id,body:String(source.document.body||''),folderId:String(source.document.folderId||'root'),path:source.file,version:''},field:source.field,kind:source.kind};
}
/** Replace URLs, including escaped slashes / numeric HTML entities, rather than IDs or captions. */
export function replaceMediaReference(value:unknown,id:string):unknown{
  if(typeof value==='string'){
    const char=(c:string)=>{const code=c.charCodeAt(0);return '(?:'+c.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&')+'|&#'+code+';|&#x0*'+code.toString(16)+';)';};
    const slash='(?:/|\\\\/|&#0*47;|&#x0*2f;)';
    const pattern=new RegExp('(?:https?:'+slash+slash+'[^\\s"\\\'<>()[\\]{}]+?)?'+slash+'api'+slash+'media'+slash+[...id].map(char).join('')+'(?![a-zA-Z0-9_-])(?:\\?[^\\s"\\\'<>()[\\]{}\\\\]*)?','gi');
    return value.replace(pattern,deletedMediaPlaceholder);
  }
  if(Array.isArray(value))return value.map(item=>replaceMediaReference(item,id));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,replaceMediaReference(item,id)]));
  return value;
}

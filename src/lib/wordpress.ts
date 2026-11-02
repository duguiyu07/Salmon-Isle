import fs from 'node:fs';
import path from 'node:path';
import { parse, Block } from '@wordpress/block-serialization-default-parser';
import { XMLParser,XMLBuilder } from 'fast-xml-parser';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { load } from 'cheerio';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { ArticleMeta, AppError } from './model';
import { digest, hashPassword,verifyPassword } from './crypto';
import { articleMeta, listArticles, listFolders, normalizeMeta, saveFolder, writeImportedArticle, trashItem, markdownFile,trashedArticleIds } from './storage';
import { addMedia, mediaUrl } from './media';
import { validStyle } from './styles';
import { audit } from './db';
import { within } from './paths';
import { protectWordPressMath } from './wordpress-math';
import { wordpressCodeMeta } from './code-block';
import {upgradeLegacyImageCaptions} from './image-caption';

export interface ImportWarning { articleId:string; title:string; block:string; message:string }
export interface ImportCandidate { meta:ArticleMeta; body:string; folder:string; folderOptions:string[]; duplicate:boolean; trash:boolean; inTrash?:boolean; warnings:ImportWarning[]; collectionPath?:string }
export interface ImportProfile { id:string; name:string; modified:string; json:Record<string,any> }
export interface ImportAnalysis { site:string; title:string; candidates:ImportCandidate[]; profiles:ImportProfile[]; profileId:string; categories:{path:string;aliases:string[]}[]; media:{url:string;relative:string;id:string}[]; warnings:ImportWarning[] }
export interface ImportChoice { id:string; selected:boolean; folder?:string; update?:boolean }
const array=<T,>(value:T|T[]|undefined):T[]=>value===undefined?[]:Array.isArray(value)?value:[value];
const text=(v:any):string=>String(typeof v==='object'&&v!==null?v['#text']??'':v??'');
const siteId=(site:string,id:string)=>`wp-${digest(`${site.toLowerCase().replace(/\/$/,'')}:${id}`).slice(0,24)}`;
export function redactImportXml(xml:string){
  const options={ignoreAttributes:false,attributeNamePrefix:'@_',textNodeName:'#text',parseTagValue:false,parseAttributeValue:false,processEntities:true};
  const document=new XMLParser(options).parse(xml);
  for(const item of array<any>(document.rss?.channel?.item))if(item['wp:post_password'])item['wp:post_password']='';
  return new XMLBuilder({ignoreAttributes:false,attributeNamePrefix:'@_',textNodeName:'#text'}).build(document);
}
function decode(s:string){return s.replace(/&(?:amp|lt|gt|quot|apos|#39|#\d+|#x[\da-f]+);/gi,e=>({ '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'" }[e] || String.fromCodePoint(e.startsWith('&#x')?parseInt(e.slice(3,-1),16):parseInt(e.slice(2,-1),10))));}
function container(name:string,body:string,attrs:Record<string,unknown>={}) {
  const lengths=[...body.matchAll(/^(:{3,})/gm)].map(m=>m[1].length);const fence=':'.repeat(Math.max(2,...lengths)+1);
  const fields=Object.entries(attrs).filter(([,v])=>v!==undefined&&v!=='').map(([k,v])=>`${k}=${JSON.stringify(String(v))}`).join(' ');
  return `${fence}${name}${fields?`{${fields}}`:''}\n${body.trim()}\n${fence}`;
}
function fenced(code:string,language:string,meta=''){const fence='`'.repeat(Math.max(2,...[...code.matchAll(/`+/g)].map(m=>m[0].length))+1);return `${fence}${language.replace(/[^\w+-]/g,'')}${meta?' '+meta:''}\n${code.replace(/\r\n/g,'\n').trimEnd()}\n${fence}`;}
const defaultPalette:Record<string,string>={base:'#ffffff',contrast:'#111111','accent-1':'#ffee58','accent-2':'#f6cff4','accent-3':'#503aa8','accent-4':'#686868','accent-5':'#fbfaf3',primary:'#75557d',secondary:'#ae84b7',tertiary:'#eaeaea'};
const defaultSpacing:Record<string,string>={'20':'10px','30':'20px','40':'30px','50':'40px','60':'60px','70':'80px','80':'120px'};
const defaultFontSizes:Record<string,string>={small:'0.875rem',medium:'1.125rem',large:'1.375rem','x-large':'2rem','xx-large':'3rem'};
function styleAttributes(attrs:Record<string,any>,profile:ImportProfile|undefined,warn:(block:string,message:string)=>void) {
  const palette={...defaultPalette};for(const p of array<any>(profile?.json.settings?.color?.palette)) if(p.slug&&p.color)palette[p.slug]=p.color;
  const spacing={...defaultSpacing};for(const p of array<any>(profile?.json.settings?.spacing?.spacingSizes))if(p.slug&&p.size)spacing[p.slug]=p.size;
  const fontSizes={...defaultFontSizes};for(const p of array<any>(profile?.json.settings?.typography?.fontSizes))if(p.slug&&p.size)fontSizes[p.slug]=p.size;
  function resolve(value:any):string {
    const s=text(value);const m=s.match(/^(?:var:preset\|([^|]+)\|([^|]+)|var\(--wp--preset--([^)-]+(?:-[^)-]+)*)--([^)]*)\))$/);
    if(s.startsWith('var:preset|')) {const [,type,key]=s.split('|');return type==='color'?palette[key]||'':type==='spacing'?spacing[key]||'':type==='font-size'?fontSizes[key]||'':'';}
    const css=s.match(/^var\(--wp--preset--(color|spacing|font-size)--([\w-]+)\)$/);if(css)return css[1]==='color'?palette[css[2]]||'':css[1]==='spacing'?spacing[css[2]]||'':fontSizes[css[2]]||'';
    return s;
  }
  const klass=String(attrs.className||'');const variant=klass.match(/is-style-(section-[123])/);
  const base=variant?profile?.json.styles?.blocks?.['core/group']?.variations?.[variant[1]]||{}:{};
  const style={...base,...attrs.style,spacing:{...base.spacing,...attrs.style?.spacing},border:{...base.border,...attrs.style?.border},color:{...base.color,...attrs.style?.color},typography:{...base.typography,...attrs.style?.typography}};
  const out:Record<string,string>={};
  if(variant) out.preset=({'section-1':'outline','section-2':'purple','section-3':'yellow'} as Record<string,string>)[variant[1]];
  const sides=(v:any)=>typeof v==='object'&&v!==null?['top','right','bottom','left'].map(k=>resolve(v[k]||'0')).join(' '):resolve(v);
  const radius=style.border?.radius;
  const values:Record<string,any>={background:attrs.backgroundColor?palette[attrs.backgroundColor]:style.color?.background,color:attrs.textColor?palette[attrs.textColor]:style.color?.text,
    borderColor:attrs.borderColor?palette[attrs.borderColor]:style.border?.color||style.border?.top?.color,borderWidth:style.border?.width||style.border?.top?.width,
    borderStyle:style.border?.style||style.border?.top?.style,radius:typeof radius==='object'?['topLeft','topRight','bottomRight','bottomLeft'].map(k=>resolve(radius[k]||'0')).join(' '):radius,
    padding:style.spacing?.padding?sides(style.spacing.padding):undefined,margin:style.spacing?.margin?sides(style.spacing.margin):undefined,
    gap:typeof style.spacing?.blockGap==='string'?style.spacing.blockGap:undefined,fontSize:style.typography?.fontSize,lineHeight:style.typography?.lineHeight,textAlign:style.typography?.textAlign};
  for(const [k,v] of Object.entries(values))if(v!==undefined&&v!==''){const value=resolve(v);if(validStyle(k,value))out[k]=value;else warn('style',`未支持的样式 ${k}: ${text(v)}`);}
  if(attrs.layout?.type==='flex'&&attrs.layout?.orientation!=='vertical')out.layout='row';
  return out;
}
export function analyzeWordPress(xml:string,profileId?:string,compat:{legacyMath?:boolean;legacyCode?:boolean;legacyQueries?:boolean;legacyCaptions?:boolean}={}):ImportAnalysis {
  if(Buffer.byteLength(xml)>50*1024*1024)throw new AppError('XML 不能超过 50MB');
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new AppError('不接受包含 DTD 或实体声明的 XML');
  const root=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',textNodeName:'#text',parseTagValue:false,parseAttributeValue:false,processEntities:true}).parse(xml);
  const channel=root.rss?.channel;if(!channel||!text(channel['wp:wxr_version']).startsWith('1.'))throw new AppError('请选择 WordPress WXR 导出 XML');
  const site=text(channel['wp:base_site_url']||channel.link).replace(/\/$/,'');const items=array<any>(channel.item);
  const profiles:ImportProfile[]=items.filter(i=>text(i['wp:post_type'])==='wp_global_styles').map(i=>{
    let json={};try{json=JSON.parse(text(i['content:encoded']));}catch{}
    return{id:text(i['wp:post_name']),name:text(i['wp:post_name']).replace('wp-global-styles-',''),modified:text(i['wp:post_modified']),json};
  }).sort((a,b)=>b.modified.localeCompare(a.modified));
  const profile=profiles.find(p=>p.id===profileId)||profiles[0];
  const categories=new Map<string,{name:string;parent:string}>();for(const c of array<any>(channel['wp:category']))categories.set(text(c['wp:category_nicename']),{name:text(c['wp:cat_name']),parent:text(c['wp:category_parent'])});
  function categoryPath(slug:string,seen=new Set<string>()):string {if(seen.has(slug))return '';seen.add(slug);const c=categories.get(slug);if(!c)return slug;return [c.parent?categoryPath(c.parent,seen):'',c.name].filter(Boolean).join('/');}
  const existing=listArticles();const trashed=trashedArticleIds();const reusable=new Map(items.filter(i=>text(i['wp:post_type'])==='wp_block').map(i=>[text(i['wp:post_id']),text(i['content:encoded'])]));
  const articleItems=items.filter(i=>['post','page'].includes(text(i['wp:post_type'])));
  const stamp=(value:string)=>{const n=Date.parse(value.replace(' ','T')+'Z');return Number.isFinite(n)?n:undefined;};
  const offsets=new Map<number,number>();for(const i of articleItems){const local=stamp(text(i['wp:post_date'])),gmt=stamp(text(i['wp:post_date_gmt']));if(local!==undefined&&gmt!==undefined){const offset=(local-gmt)/60000;if(Math.abs(offset)<=14*60)offsets.set(offset,(offsets.get(offset)||0)+1);}}
  const offsetMinutes=[...offsets].sort((a,b)=>b[1]-a[1])[0]?.[0]??480;
  function dateValue(gmt:string,local:string){const utc=stamp(gmt),fallback=stamp(local);const value=utc??(fallback!==undefined?fallback-offsetMinutes*60000:0);return new Date(value).toISOString().replace('.000Z','Z');}
  const summaryFields=[...items.filter(i=>text(i['wp:post_type'])==='acf-field'&&/简介|摘要|intro|summary|description/i.test(text(i.title))).map(i=>text(i['excerpt:encoded']||i['wp:post_excerpt'])).filter(Boolean),'intro','summary','简介'];
  const linkMap=new Map<string,string>();for(const i of articleItems){const id=siteId(site,text(i['wp:post_id']));const canonical=`/posts/${id}`;linkMap.set(text(i.link),canonical);linkMap.set(`${site}/?p=${text(i['wp:post_id'])}`,canonical);linkMap.set(`${site}/?page_id=${text(i['wp:post_id'])}`,canonical);}
  function categorySlugs(slug:string,seen=new Set<string>()):string{if(seen.has(slug))return '';seen.add(slug);const parent=categories.get(slug)?.parent;return[parent?categorySlugs(parent,seen):'',slug].filter(Boolean).join('/');}
  const categoryFolders=[...categories.keys()].map(slug=>{const slugs=categorySlugs(slug);const aliases=[`/archives/category/${slugs}`,`/category/${slugs}`];for(const alias of aliases)linkMap.set(site+alias,alias);return{path:categoryPath(slug),aliases};});
  const media=items.filter(i=>text(i['wp:post_type'])==='attachment').map(i=>{
    const url=text(i['wp:attachment_url']);let relative='';try{relative=decodeURIComponent(new URL(url).pathname.split('/uploads/')[1]||'');}catch{}
    return{url,relative,id:text(i['wp:post_id'])};
  });
  const candidates:ImportCandidate[]=[];const allWarnings:ImportWarning[]=[];
  for(const item of articleItems){
    let collectionPath:string|undefined;let collectionPerPage=10;
    const serializedBlocks=parse(text(item['content:encoded']));let queryCount=0;
    const countQueries=(blocks:Block[])=>{for(const block of blocks){if(block.blockName==='core/query')queryCount++;countQueries(block.innerBlocks);}};countQueries(serializedBlocks);
    const id=siteId(site,text(item['wp:post_id']));const title=text(item.title)||`WordPress ${text(item['wp:post_id'])}`;const warnings:ImportWarning[]=[];
    const warn=(block:string,message:string)=>warnings.push({articleId:id,title,block,message});
    const service=new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced',bulletListMarker:'-',emDelimiter:'*'});service.use(gfm);
    service.addRule('strong-breaks',{filter:['strong','b'],replacement:content=>{const trailing=content.match(/(?: {2}\n)+$/)?.[0]||'';const value=content.trim();return value?`**${value}**${trailing}`:'';}});
    service.addRule('formula',{filter:node=>node.nodeName==='MATH'&&node.hasAttribute('data-latex'),replacement:(_content,node)=>`$${(node as HTMLElement).getAttribute('data-latex')}$`});
    service.addRule('inline-style',{filter:node=>['MARK','SPAN'].includes(node.nodeName)&&node.hasAttribute('style'),replacement:(content,node)=>{
      const el=node as HTMLElement;const style=el.getAttribute('style')||'';const supported=style.split(';').filter(s=>/^\s*(?:background-color|color|font-size|font-weight|text-decoration)\s*:/.test(s)).join(';');
      return supported?`<${el.nodeName.toLowerCase()} style="${supported.replace(/"/g,'&quot;')}">${content}</${el.nodeName.toLowerCase()}>`:content;
    }});
    service.addRule('spoiler',{filter:node=>(node as HTMLElement).classList?.contains('heimu'),replacement:content=>`:spoiler[${content}]`});
    if(!compat.legacyCaptions)service.addRule('figure-caption',{
      filter:node=>node.nodeName==='FIGURE'&&node.querySelectorAll('img').length===1&&Array.from(node.children).some(child=>child.tagName==='FIGCAPTION'),
      replacement:(_content,node)=>{
        const figure=(node as HTMLElement).cloneNode(true) as HTMLElement;
        const caption=Array.from(figure.children).find(child=>child.tagName==='FIGCAPTION')!;
        const description=service.turndown(caption.innerHTML).trim();caption.remove();
        const image=service.turndown(figure.outerHTML).trim();
        return description?'\n\n'+container('figure',image+'\n\n'+description)+'\n\n':'\n\n'+image+'\n\n';
      },
    });
    function html(input:string){
      const $=load(input,null,false);const protectedMath=compat.legacyMath?undefined:protectWordPressMath($,message=>warn('math',message));$('script,style,object,embed,form,input,button').remove();
      $('iframe').each((_,e)=>{const src=$(e).attr('src')||'';$(e).replaceWith($('<a>').attr('href',src.startsWith('//')?`https:${src}`:src).text('打开嵌入内容 ↗'));warn('iframe','嵌入内容已转换为外部链接');});
      $('*').each((_,e)=>{for(const key of Object.keys(('attribs' in e && e.attribs)||{}))if(/^on/i.test(key))$(e).removeAttr(key);});
      $('a').each((_,e)=>{const href=$(e).attr('href')||'';if(/^javascript:/i.test(href))$(e).removeAttr('href');else if(linkMap.has(href))$(e).attr('href',linkMap.get(href)!);else{const hash=href.indexOf('#');if(hash>0&&linkMap.has(href.slice(0,hash)))$(e).attr('href',linkMap.get(href.slice(0,hash))!+href.slice(hash));}});
      const markdown=service.turndown($.html()).replace(/\u00a0/g,' ');return protectedMath?protectedMath.restore(markdown):markdown;
    }
    function convert(block:Block,refs=new Set<string>()):string {
      const n=block.blockName||'html';const a=block.attrs||{};const child=()=>block.innerBlocks.map(b=>convert(b,refs)).filter(Boolean).join('\n\n');
      if(n==='core/group'){const attrs=styleAttributes(a,profile,warn);return container('group',child()||html(block.innerHTML),attrs.preset?attrs:{preset:'plain',...attrs});}
      if(n==='core/details'){const $=load(block.innerHTML);return container('details',child()||html($('details').html()?.replace(/<summary[\s\S]*?<\/summary>/i,'')||''),{title:$('summary').first().text()||'详细信息',...(a.showContent?{open:'true'}:{}),...styleAttributes(a,profile,warn)});}
      if(n==='kevinbatdorf/code-block-pro'||n==='core/code'){const $=load(block.innerHTML);const code=decode(a.code!==undefined?String(a.code):$('pre').text());return fenced(code,String(a.language||a.languageName||$('code').attr('class')?.replace('language-','')||'text'),compat.legacyCode?'':wordpressCodeMeta(a,code));}
      if(n==='katex/display-block'){const $=load(block.innerHTML);return `$$\n${$('pre').text().trim()}\n$$`;}
      if(n==='core/math'){const $=load(block.innerHTML);return `$$\n${a.latex||$('math').attr('data-latex')||$('annotation').text()||$('pre').text()}\n$$`;}
      if(n==='core/tabs')return container('tabs',child());
      if(n==='core/tab-list')return '';
      if(n==='core/tab-panels')return child();
      if(n==='core/tab-panel')return container('tab',child(),{title:a.label||'标签页'});
      if(n==='core/columns')return container('columns',child());
      if(n==='core/column')return container('column',child());
      if(n==='core/gallery')return container('gallery',child()||html(block.innerHTML));
      if(n==='core/query'&&queryCount===1&&!compat.legacyQueries&&text(item['wp:post_type'])==='page'){
        const selected=array<any>(a.query?.taxQuery?.include?.category);
        const category=selected.length===1?array<any>(channel['wp:category']).find(c=>text(c['wp:term_id'])===String(selected[0])):undefined;
        if(category&&a.query?.postType==='post'&&!a.query?.inherit){collectionPath=categoryPath(text(category['wp:category_nicename']));collectionPerPage=Math.max(1,Math.min(50,Number(a.query.perPage)||10));return '';}
      }
      if(n==='core/block'){
        const ref=String(a.ref);if(refs.has(ref)||!reusable.has(ref)){warn(n,'复用区块丢失或循环引用');return '> [待处理：复用区块引用缺失]';}
        return parse(reusable.get(ref)!).map(b=>convert(b,new Set([...refs,ref]))).join('\n\n');
      }
      if(n==='core/shortcode'){warn(n,'短代码不执行，保留为文字；文章目录由新系统生成');return /muki_floating_toc/.test(block.innerHTML)?'':fenced(block.innerHTML,'text');}
      if(n==='core/spacer')return '';
      if(['core/query','core/post-template','core/query-pagination','core/query-pagination-next','core/query-pagination-previous','core/query-no-results','core/post-title','core/post-excerpt','core/post-date','core/post-featured-image','acf-field-blocks/acf-text'].includes(n)){warn(n,'动态 WordPress 区块需要重新绑定新系统内容');return block.innerBlocks.length?child():`> [待处理：${n} 动态内容]`;}
      if(n==='core/html'||n==='html')return html(block.innerHTML);
      if(['core/paragraph','core/heading','core/list','core/list-item','core/image','core/table','core/quote','core/separator','core/verse','core/preformatted'].includes(n)){
        const base=html(block.innerHTML);
        if(n==='core/list'&&block.innerBlocks.length)return html(block.innerContent.map((s,index)=>s===null?'':s).join(''))||html(block.innerHTML)||child();
        const rendered=base||child();
        if(n==='core/paragraph'&&String(a.className||'').includes('is-style-text-display')){
          const variant=profile?.json.styles?.blocks?.['core/paragraph']?.variations?.['text-display']||{};
          return container('group',rendered,{preset:'plain',...styleAttributes({...a,style:{...variant,...a.style}},profile,warn)});
        }
        return rendered;
      }
      warn(n,'不支持的区块已尽量保留文字和子内容');return child()||html(block.innerHTML);
    }
    // Lists contain interleaved child HTML. Rehydrate those before converting with Turndown.
    function hydrate(block:Block):Block {if(block.blockName==='core/list'||block.blockName==='core/list-item'){let index=0;return{...block,innerHTML:block.innerContent.map(s=>s===null?hydrate(block.innerBlocks[index++]).innerHTML:s).join(''),innerBlocks:[]};}return{...block,innerBlocks:block.innerBlocks.map(hydrate)};}
    const converted=serializedBlocks.map(hydrate).map(b=>convert(b)).filter(Boolean).join('\n\n');
    const body=compat.legacyCaptions?converted:upgradeLegacyImageCaptions(converted);
    const terms=array<any>(item.category);const paths=terms.filter(c=>c['@_domain']==='category').map(c=>categoryPath(text(c['@_nicename']))).filter(Boolean);
    const leaves=[...new Set(paths)].filter(p=>!paths.some(other=>other!==p&&other.startsWith(p+'/')));
    const kind=text(item['wp:post_type'])==='page'?'page':'post';const fallback=kind==='page'?'独立页面':'未分类';
    const folderOptions=kind==='page'?[fallback]:leaves.length?leaves:[fallback];if(folderOptions.length>1)warn('category','文章属于多个独立分类，请选择一个目标文件夹');
    const metadata=new Map(array<any>(item['wp:postmeta']).map(m=>[text(m['wp:meta_key']),text(m['wp:meta_value'])]));
    const thumbnail=media.find(m=>m.id===metadata.get('_thumbnail_id'));const password=text(item['wp:post_password']);const status=text(item['wp:status']);
    const aliases:string[]=[];try{const old=new URL(text(item.link));aliases.push(old.pathname+old.search);}catch{}
    if(kind==='page'){const slug=text(item['wp:post_name']);if(slug)aliases.push('/'+decodeURIComponent(slug));}
    const previous=existing.find(a=>a.id===id);const passwordHash=password?(previous?.passwordHash&&verifyPassword(password,previous.passwordHash)?previous.passwordHash:hashPassword(password)):undefined;
    const meta=normalizeMeta({id,title,kind,status:status==='publish'||status==='private'?'published':'draft',createdAt:dateValue(text(item['wp:post_date_gmt']),text(item['wp:post_date'])),updatedAt:dateValue(text(item['wp:post_modified_gmt']),text(item['wp:post_modified'])),
      summary:text(item['excerpt:encoded']).replace(/<[^>]*>/g,'').trim()||summaryFields.map(key=>text(metadata.get(key))).find(Boolean)||'',pinned:text(item['wp:is_sticky'])==='1',access:status==='private'?'private':password?'password':'inherit',...(passwordHash?{passwordHash}:{}),cover:thumbnail?.url,aliases,tags:terms.filter(c=>c['@_domain']==='post_tag').map(text),giscusTerm:`${title} – ${text(channel.title)}`,source:{site,id:text(item['wp:post_id'])},...(collectionPath?{template:'collection',collection:{folderId:listFolders().find(f=>f.path===collectionPath)?.id||'',perPage:collectionPerPage}}:{})});
    const external=[...converted.matchAll(/!\[[^\]]*\]\((https?:[^\s)]+)/g)].length;if(external)warn('media',`${external} 个远程图片引用；未提供媒体包时将保留外链，外链不受新站权限保护`);
    const candidate={meta,body,folder:folderOptions.length===1?folderOptions[0]:'待分类',folderOptions,duplicate:trashed.has(id)||existing.some(a=>a.source?.site===site&&a.source.id===text(item['wp:post_id'])),inTrash:trashed.has(id),trash:status==='trash',warnings,...(collectionPath?{collectionPath}:{})};
    candidates.push(candidate);allWarnings.push(...warnings);
  }
  return{site,title:text(channel.title),candidates,profiles,profileId:profile?.id||'',categories:categoryFolders,media,warnings:allWarnings};
}
export function readMediaZip(bytes:Uint8Array){
  if(bytes.length>256*1024*1024)throw new AppError('媒体包压缩大小不能超过 256MB');let total=0;
  const files=unzipSync(bytes,{filter:file=>{
    const name=file.name.replace(/\\/g,'/');if(name.startsWith('/')||/^[A-Za-z]:/.test(name)||name.split('/').includes('..')||name.includes('\0'))throw new AppError('媒体包含非法路径');
    total+=file.originalSize;if(file.originalSize>40*1024*1024||total>1024*1024*1024)throw new AppError('媒体包解压大小超出限制');
    return !name.endsWith('/')&&/\.(png|jpe?g|webp|gif|avif|svg|pdf|mp3|mp4|webm|txt|zip)$/i.test(name);
  }});
  const normalized=new Map<string,Buffer>();for(const [name,data]of Object.entries(files)){const clean=name.replace(/\\/g,'/');const part=clean.includes('/uploads/')?clean.split('/uploads/')[1]:clean.replace(/^uploads\//,'');normalized.set(part,Buffer.from(data));}return normalized;
}
function ensureFolder(folderPath:string,aliases:string[]=[]){let parent='root';for(const name of folderPath.split('/').filter(Boolean)){const found=listFolders().find(f=>f.parentId===parent&&f.name===name);parent=found?.id||saveFolder({name,parentId:parent}).id;}if(aliases.length){const found=listFolders().find(f=>f.id===parent)!;const merged=[...new Set([...(found.aliases||[]),...aliases])];if(merged.length!==(found.aliases||[]).length)saveFolder({...found,aliases:merged});}return parent;}
export function commitImport(analysis:ImportAnalysis,choices:ImportChoice[],options:{zip?:Uint8Array;mediaRoot?:string;rootFolder?:string}={}){
  const files=options.zip?readMediaZip(options.zip):new Map<string,Buffer>();const result={imported:0,updated:0,skipped:0,trashed:0,warnings:[] as ImportWarning[],ids:[] as string[]};
  const trashed=trashedArticleIds();const existingIds=new Set(listArticles().map(a=>a.id));
  if(choices.some(c=>c.selected&&!trashed.has(c.id)&&(!existingIds.has(c.id)||c.update)))for(const category of analysis.categories||[])ensureFolder([options.rootFolder,category.path].filter(Boolean).join('/'),category.aliases);
  for(const candidate of analysis.candidates){const choice=choices.find(c=>c.id===candidate.meta.id);if(!choice?.selected){result.skipped++;continue;}
    if(trashed.has(candidate.meta.id)){result.skipped++;continue;}
    if(findExisting(candidate.meta.id)&&!choice.update){result.skipped++;continue;}
    let body=candidate.body;let meta={...candidate.meta};
    if(candidate.collectionPath)meta.collection={folderId:ensureFolder([options.rootFolder,candidate.collectionPath].filter(Boolean).join('/')),perPage:meta.collection?.perPage||10};
    const references=new Map(analysis.media.map(m=>[m.url,m]));
    for(const match of (body+'\n'+(meta.cover||'')).matchAll(/https?:\/\/[^\s)<>"']+\/uploads\/[^\s)<>"']+/g)){
      try{const url=new URL(match[0]);if(!url.pathname.includes('/wp-content/uploads/'))continue;const relative=decodeURIComponent(url.pathname.split('/uploads/')[1]||'');if(relative&&!references.has(match[0]))references.set(match[0],{url:match[0],relative,id:''});}catch{}
    }
    for(const media of references.values()){
      if(!media.relative||(!body.includes(media.url)&&meta.cover!==media.url))continue;
      let bytes=files.get(media.relative);
      if(!bytes&&options.mediaRoot){const base=path.resolve(options.mediaRoot);const file=within(base,media.relative);if(fs.existsSync(file)&&fs.statSync(file).isFile())bytes=fs.readFileSync(file);}
      if(!bytes){result.warnings.push({articleId:meta.id,title:meta.title,block:'media',message:`未本地化：${media.relative}`});continue;}
      try{const asset=addMedia(path.basename(media.relative),bytes,meta.id,`${analysis.site}:${media.relative}`);const url=mediaUrl(asset.id,meta.id);body=body.split(media.url).join(url);if(meta.cover===media.url)meta.cover=url;}
      catch(e){result.warnings.push({articleId:meta.id,title:meta.title,block:'media',message:e instanceof Error?e.message:'附件失败'});}
    }
    const folder=ensureFolder([options.rootFolder,choice.folder||candidate.folder].filter(Boolean).join('/'));
    const current=findExisting(meta.id);
    if(current&&choice.update&&current.folderId===folder&&current.body.trim()===body.trim()&&JSON.stringify(articleMeta(current))===JSON.stringify(meta)){result.skipped++;continue;}
    const existed=!!findExisting(meta.id);writeImportedArticle(meta,body,folder,!!choice.update);result[existed?'updated':'imported']++;result.ids.push(meta.id);
    if(candidate.trash){trashItem(meta.id,'article');result.trashed++;}
  }
  audit('wordpress.import',JSON.stringify({imported:result.imported,updated:result.updated,skipped:result.skipped}));return result;
}
function findExisting(id:string){return listArticles().find(a=>a.id===id);}
export function convertedZip(analysis:ImportAnalysis){const files:Record<string,Uint8Array>={};for(const c of analysis.candidates)files[`${c.meta.id}.md`]=strToU8(markdownFile(c.meta,c.body));files['conversion-report.json']=strToU8(JSON.stringify(analysis.warnings,null,2));return zipSync(files);}

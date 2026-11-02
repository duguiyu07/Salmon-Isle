import {unified} from 'unified';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize,{defaultSchema} from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import {load} from 'cheerio';
import postcss from 'postcss';
import {visit} from 'unist-util-visit';
import {getSettings,listArticles,listFolders} from './storage';
import {publicArticle} from './access';
import {descendantIds,knowledgeData,publicData} from './public-data';
import {paginate,archiveHref} from './pagination';
import type {Article,PublicArticle,Viewer} from './model';

export type PageQuery=Record<string,string|undefined>;
export const escapeHtml=(text:unknown)=>String(text??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const icon=(paths:string,size=17,className='',label='')=>`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="${className}" ${label?`aria-label="${label}"`:'aria-hidden="true"'}>${paths}</svg>`;
const lock=icon('<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/>',17,'card-lock','密码保护');
const pin=icon('<path d="m16 3 5 5-4 1-3 3v4l-3-3-6 6m1-10L3 6l4-1 3-3z"/>',13,'card-pin','置顶');
const folderIcon=icon('<path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z"/>');
const filesIcon=icon('<path d="M6 3H3v18h15v-3M8 1h8l5 5v12H8zM16 1v5h5"/>');
const chevron=icon('<path d="m9 18 6-6-6-6"/>',13);
export function pageRootClass(route?:string){return route==='/'?'home-page reading-width':route==='/knowledge'?'knowledge-page':'reading-width standalone-page'+(route==='/links'?' links-page':'');}

/** Native CSS scoping also covers selectors inside media queries and nesting. */
export function scopedPageCss(source:string,id:string){
  const root=postcss.parse(source||'');const prefix=`page-${id.replace(/[^a-zA-Z0-9_-]/g,'')}-`,animations=new Map<string,string>();
  root.walkAtRules(rule=>{if(/^(?:-webkit-)?keyframes$/i.test(rule.name)){animations.set(rule.params,prefix+rule.params);rule.params=prefix+rule.params;}
    else if(!/^(?:media|supports|container|layer|starting-style|scope)$/i.test(rule.name))rule.remove();});
  root.walkRules(rule=>{if(rule.parent?.type==='atrule'&&/keyframes$/i.test(rule.parent.name))return;rule.selector=rule.selector.replace(/(^|[\s,>+~])(?:html|body|:root)(?=$|[\s,.#[:>+~])/g,'$1:scope');});
  root.walkDecls(declaration=>{
    if(/expression\s*\(|(?:javascript|vbscript)\s*:|@import|\\(?:0*6a|0*76)/i.test(declaration.value)||/^(?:behavior|-moz-binding)$/i.test(declaration.prop)){declaration.remove();return;}
    if(/^(?:-webkit-)?animation(?:-name)?$/.test(declaration.prop))for(const [before,after] of animations)declaration.value=declaration.value.replace(new RegExp(`(?<![\\w-])${before.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\w-])`,'g'),after);
  });
  const css=root.toString().replace(/</g,'\\3c ');
  return css.trim()?`@scope (.managed-page[data-page-id="${id.replace(/[^a-zA-Z0-9_-]/g,'')}"]) {\n${css}\n}`:'';
}
const schema:any={...defaultSchema,clobberPrefix:'',tagNames:[...(defaultSchema.tagNames||[]),'div','section','article','header','footer','main','nav','aside','details','summary','figure','figcaption','mark','time','button'],attributes:{
  ...defaultSchema.attributes,'*':[...(defaultSchema.attributes?.['*']||[]),'className','id','style','title','role','ariaLabel','ariaHidden','ariaCurrent'],
  div:['className','id','style','dataPageSlot','dataFolderId','dataPerPage','role','ariaLabel'],
  details:['open','className','style'],time:['dateTime','className'],button:['type','className','ariaLabel'],
  a:[...(defaultSchema.attributes?.a||[]),'className','target','rel','ariaLabel'],img:[...(defaultSchema.attributes?.img||[]),'className','loading','decoding','width','height']
}};
for(const [tag,attributes] of Object.entries(schema.attributes) as [string,any[]][])schema.attributes[tag]=[...attributes.filter(attribute=>!['className','id','style'].includes(Array.isArray(attribute)?attribute[0]:attribute)),'className','id','style'];
export async function sanitizePageHtml(source:string){
  const processor=unified().use(function(){this.parser=(value:string)=>({type:'root',children:[{type:'raw',value}]}) as any;})
    .use(rehypeRaw).use(rehypeSanitize,schema).use(()=>(tree:any)=>visit(tree,'element',(node:any)=>{
      if(node.properties?.style){try{const parsed=postcss.parse(`x{${node.properties.style}}`);parsed.walkAtRules(rule=>{rule.remove();});parsed.walkDecls(declaration=>{if(/expression\s*\(|(?:javascript|vbscript)\s*:|@import/i.test(declaration.value)||/^(?:behavior|-moz-binding)$/i.test(declaration.prop))declaration.remove();});node.properties.style=parsed.first?.type==='rule'?parsed.first.nodes.map(n=>n.toString()).join(';'):'';}catch{delete node.properties.style;}}
      if(node.tagName==='a'&&/^https?:/.test(node.properties?.href||'')){node.properties.target='_blank';node.properties.rel=['noopener','noreferrer'];}
      if(node.tagName==='button')node.properties.type='button';
    })).use(rehypeStringify);
  return String(await processor.process(source));
}
function card(article:PublicArticle,compact=false){
  const href='/posts/'+encodeURIComponent(article.id),title=escapeHtml(article.title),locked=article.locked?lock:'';
  if(compact)return `<article class="compact-article"><h3>${locked}<a href="${href}">${title}</a></h3><p class="compact-summary"${article.summary?'':' aria-hidden="true"'}>${escapeHtml(article.summary)||'&nbsp;'}</p></article>`;
  const date=new Date(article.createdAt).toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Hong_Kong'}).replaceAll('/','.');
  return `<article class="article-card${article.cover?' with-cover':''}">${article.cover?`<a href="${href}" class="card-cover" tabindex="-1" aria-hidden="true"><img src="${escapeHtml(article.cover)}" alt="" loading="lazy"></a>`:''}<div class="article-card-content"><h3>${locked}<a href="${href}">${title}</a>${article.pinned?pin:''}</h3>${article.summary?`<p class="card-summary">${escapeHtml(article.summary)}</p>`:''}<div class="card-bottom"><time datetime="${escapeHtml(article.createdAt)}">${date}</time></div></div></article>`;
}
function pagination(current:number,pages:number,href:(page:number)=>string){return pages>1?`<nav class="pagination" aria-label="分页">${current>1?`<a href="${escapeHtml(href(current-1))}">← 上一页</a>`:''}<span>${current} / ${pages}</span>${current<pages?`<a href="${escapeHtml(href(current+1))}">下一页 →</a>`:''}</nav>`:'';}
function homePosts(viewer:Viewer,query:PageQuery){
  const folders=listFolders(),settings=getSettings();
  const branches=settings.homeFolders.map(id=>descendantIds(folders,id));
  const articles=listArticles().filter(a=>a.kind==='post'&&(!branches.length||branches.some(ids=>ids.has(a.folderId)))).map(a=>publicArticle(a,viewer,folders)).filter(a=>a!==null);
  const pinned=articles.filter(a=>a.pinned),recent=paginate(articles.filter(a=>!a.pinned),query.page,8);
  return `${pinned.length?`<section class="home-section"><div class="section-label"><h2>置顶文章</h2></div><div class="article-list">${pinned.map(a=>card(a)).join('')}</div></section>`:''}<section class="home-section"><div class="section-label"><h2>最近文章</h2><a href="/knowledge">全部文章 ↗</a></div><div class="article-list">${recent.items.map(a=>card(a)).join('')}</div>${!articles.length?'<div class="empty-state"><h2>暂无已发布文章</h2><a class="outline-link" href="/admin">写下第一篇文章 ↗</a></div>':''}${pagination(recent.current,recent.pages,n=>'/?page='+n)}</section>`;
}
function archive(viewer:Viewer,query:PageQuery){
  const data=knowledgeData(viewer),selected=data.folders.find(f=>f.id===query.folder)||data.folders.find(f=>f.id==='root')!,ids=descendantIds(data.folders,selected.id),q=(query.q||'').trim().toLowerCase();
  let articles=data.articles.filter(a=>(selected.id==='root'||ids.has(a.folderId))&&(!q||a.title.toLowerCase().includes(q)));
  if(query.sort==='title')articles=articles.toSorted((a,b)=>a.title.localeCompare(b.title,'zh-CN',{numeric:true}));else if(query.sort!=='order')articles=articles.toSorted((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
  const page=paginate(articles,query.page,15);
  const row=(id:string,depth:number):string=>data.folders.filter(f=>f.parentId===id&&f.id!=='root').map(f=>{
    const children=data.folders.some(child=>child.parentId===f.id),tag=children?'summary':'div';
    const link=`<${tag} class="tree-row ${selected.id===f.id?'active':''}" style="padding-left:${depth*14+6}px"><span class="tree-chevron${children?'':' invisible'}">${chevron}</span><a class="tree-select" href="/knowledge?folder=${encodeURIComponent(f.id)}"><span class="tree-folder-icon">${folderIcon}</span><span class="tree-label">${escapeHtml(f.name)}</span>${f.locked?lock:''}</a></${tag}>`;
    return children?`<details open class="page-folder-branch">${link}${row(f.id,depth+1)}</details>`:link;
  }).join('');
  return `<div class="knowledge-layout reading-width"><nav class="knowledge-tree" aria-label="文章分类"><div class="folder-tree"><a class="tree-root ${selected.id==='root'?'active':''}" href="/knowledge">${filesIcon}<span>所有文章</span></a>${row('root',0)}</div></nav><section class="knowledge-content" aria-label="${escapeHtml(selected.name)}"><div class="compact-list">${page.items.map(a=>card(a,true)).join('')}${articles.length?'':`<div class="empty-state"><h3>${q?'没有找到相关文章':'暂无已发布文章'}</h3></div>`}</div>${pagination(page.current,page.pages,n=>archiveHref(n,{folder:selected.id,q:query.q,sort:query.sort}))}</section></div>`;
}
export async function renderHtmlPage(page:Pick<Article,'id'|'body'|'css'|'route'|'collection'>,viewer:Viewer,query:PageQuery={}){
  const sanitized=await sanitizePageHtml(page.body),$=load(sanitized,null,false);
  $('[data-page-slot]').each((_,element)=>{
    const slot=$(element).attr('data-page-slot');let html='';
    if(slot==='home-posts')html=homePosts(viewer,query);
    else if(slot==='archive')html=archive(viewer,query);
    else if(slot==='collection'){
      const folderId=$(element).attr('data-folder-id')||page.collection?.folderId||'',ids=descendantIds(listFolders(),folderId);
      const perPage=Math.min(50,Math.max(1,Number($(element).attr('data-per-page'))||page.collection?.perPage||10));
      const articles=publicData(viewer).articles.filter(a=>ids.has(a.folderId)).toSorted((a,b)=>b.createdAt.localeCompare(a.createdAt));
      const result=paginate(articles,query.page,perPage),route=page.route||'/posts/'+page.id;
      html=`<section class="collection-list" aria-label="文章列表"><div class="article-list">${result.items.map(a=>card(a)).join('')}</div>${articles.length?'':'<p class="muted empty-state">暂无已发布文章。</p>'}${pagination(result.current,result.pages,n=>route+'?page='+n)}</section>`;
    }
    $(element).replaceWith(html);
  });
  return {html:$.html(),css:scopedPageCss(page.css||'',page.id),className:pageRootClass(page.route)};
}

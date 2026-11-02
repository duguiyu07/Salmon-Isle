import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {listArticles,findArticle,saveArticle,trashItem,atomicWrite} from './storage';
import {dataDir} from './paths';
import {renderMarkdown} from './markdown';
import {normalizePageRoute} from './page-routes';
import {readEditorDraft} from './editor-drafts';
import type {Article} from './model';

export const archivePageHtml='<header class="knowledge-heading reading-width"><h1 class="page-title">Index</h1>\n<p class="muted index-intro">*可在此查看网站的所有内容。归类为杂项/其他的文章除外，这类文章位于 MISC 页面。</p>\n<nav class="index-shortcuts" aria-label="其他归档"><a class="shortcut-card" href="/misc"><strong>MISC</strong><span>杂谈 / 日常类文章归档</span></a><a class="shortcut-card" href="/links"><strong>Links</strong><span>相关网站 / 友情链接归档</span></a></nav></header>\n<div data-page-slot="archive"></div>';
export async function convertLegacyPage(page:Article,patch:Partial<Article>={}){
  if(page.kind!=='page')return page;
  const route=patch.route||page.route||page.aliases.map(normalizePageRoute).find(Boolean)||'/pages/'+page.id;
  const body=patch.body??(page.contentFormat==='html'?page.body:(await renderMarkdown(page.body,{pageTitle:true})).html+(page.template==='collection'?'\n<div data-page-slot="collection"></div>':''));
  const next={...page,...patch,body,route,contentFormat:'html' as const,css:patch.css??page.css??''};
  if(['title','body','route','contentFormat','css'].every(key=>(page as any)[key]===(next as any)[key]))return page;
  const draft=readEditorDraft(page.id),saved=saveArticle(next);
  if(draft){
    const document={...draft.document,contentFormat:'html' as const,css:draft.document.css||'',route:draft.document.route||route};
    if(draft.document.contentFormat!=='html')document.body=(await renderMarkdown(document.body,{pageTitle:true})).html+(document.template==='collection'?'\n<div data-page-slot="collection"></div>':'');
    atomicWrite(path.join(dataDir(),'editor-drafts',page.id+'.json'),JSON.stringify({...draft,baseVersion:saved.version,draftVersion:randomUUID(),document}));
  }
  return saved;
}
export async function convertLegacyPages(ids?:string[]){
  for(const page of listArticles().filter(a=>a.kind==='page'&&a.contentFormat!=='html'&&(!ids||ids.includes(a.id))))await convertLegacyPage(page);
}
export async function migratePages(apply=false){
  const marker=path.join(dataDir(),'page-migration-v1.json');
  if(fs.existsSync(marker))return {alreadyApplied:true,kept:listArticles().filter(a=>a.kind==='page').map(a=>({id:a.id,title:a.title,route:a.route})),removed:[]};
  const pages=listArticles().filter(a=>a.kind==='page');
  const definitions=[{route:'/',title:'首页',aliases:[] as string[]},{route:'/about',title:'关于',aliases:['/about']},{route:'/knowledge',title:'归档',aliases:['/index']},{route:'/misc',title:'MISC',aliases:['/misc']},{route:'/links',title:'Links',aliases:['/links']}];
  const chosen=definitions.map(definition=>({...definition,page:pages.find(page=>page.route===definition.route)||pages.find(page=>definition.aliases.some(alias=>page.aliases.includes(alias)))}));
  const retained=new Set(chosen.map(row=>row.page?.id).filter(Boolean)),removed=pages.filter(page=>!retained.has(page.id)).map(page=>({id:page.id,title:page.title}));
  const kept=chosen.map(row=>({id:row.page?.id||(row.route==='/'?'page-home':`page-${row.route.slice(1)}`),title:row.title,route:row.route}));
  if(apply){
    const folderId=chosen.find(row=>row.page)?.page?.folderId||'root';
    for(let index=0;index<chosen.length;index++){
      const row=chosen[index];
      const seed=row.route==='/'?'<div data-page-slot="home-posts"></div>':row.route==='/knowledge'?archivePageHtml:undefined;
      if(row.page)await convertLegacyPage(row.page,{title:row.title,route:row.route,...(seed?{body:seed}:{})});
      else saveArticle({id:kept[index].id,title:row.title,route:row.route,body:seed||`<h1 class="page-title">${row.title}</h1>`,contentFormat:'html',css:'',kind:'page',status:'published',folderId,aliases:row.aliases,access:'public'},{create:true});
    }
    for(const page of removed)if(findArticle(page.id))trashItem(page.id,'article');
    atomicWrite(marker,JSON.stringify({version:1,time:new Date().toISOString(),kept,removed},null,2));
  }
  return {alreadyApplied:false,kept,removed};
}

import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {load} from 'cheerio';
import {closeDatabases} from '../src/lib/db';
import {getSettings,saveSettings,saveFolder,saveArticle,listArticles,listTrash,findArticle} from '../src/lib/storage';
import {articleForEditorViewer,saveEditorDraft,pushEditorDraft} from '../src/lib/editor-drafts';
import {draftFingerprint} from '../src/lib/editor-draft-model';
import {renderHtmlPage,sanitizePageHtml,scopedPageCss} from '../src/lib/html-pages';
import {migratePages,convertLegacyPage} from '../src/lib/page-migration';
import {normalizePageRoute} from '../src/lib/page-routes';

let directory='';
const visitor={admin:false,grants:new Set<string>()},admin={admin:true,grants:new Set<string>()};
beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-html-pages-'));process.env.SALMON_DATA_DIR=directory;});
afterEach(()=>{closeDatabases();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'salmon-html-pages-'));fs.rmSync(directory,{recursive:true,force:true});});

test('HTML and CSS round trip exactly, are fingerprinted, and use staged publishing',()=>{
  const page=saveArticle({title:'页面',kind:'page',contentFormat:'html',body:'<h1>已发布</h1>',css:'h1 { color: red; }',route:'/example',status:'published'});
  const document={...page,body:'<section>\n\n<h1>编辑稿</h1>\n</section>',css:'h1 { color: blue; }'};
  assert.notEqual(draftFingerprint(page),draftFingerprint(document));
  const result=saveEditorDraft(page.id,document,{baseVersion:page.version,draftVersion:null});assert.equal(findArticle(page.id)!.body,page.body);
  assert.equal(articleForEditorViewer(page,true).body,page.body);
  const pushed=pushEditorDraft(page.id,{baseVersion:page.version,draftVersion:result.draft.draftVersion});
  assert.equal(pushed.body,document.body);assert.equal(pushed.css,document.css);assert.equal(pushed.route,'/example');
  const draft=saveEditorDraft('draft-page',{title:'草稿页',kind:'page',contentFormat:'html',body:'<p>保存后的草稿</p>',css:'p{}',route:'/draft',folderId:'root'},{baseVersion:null,draftVersion:null});
  assert.equal(draft.article.kind,'page');assert.equal(articleForEditorViewer(draft.article,true).body,'<p>保存后的草稿</p>');assert.equal(articleForEditorViewer(draft.article,false).body,'');
  assert.throws(()=>saveEditorDraft(page.id,{...pushed,kind:'post'},{baseVersion:pushed.version,draftVersion:null}),/不能互相转换/);
});

test('page sanitizer preserves authored layout and slots while removing executable content',async()=>{
  const html=await sanitizePageHtml('<section class="hero" id="hello" style="display:grid;gap:12px"><h1>Hello</h1><div data-page-slot="archive"></div><a href="javascript:alert(1)" onclick="x()">链接</a><script>x()</script><style>body{display:none}</style></section>');
  const $=load(html);assert.equal($('.hero').attr('id'),'hello');assert.match($('.hero').attr('style')||'',/display:grid/);assert.equal($('[data-page-slot=archive]').length,1);assert.doesNotMatch(html,/<script|<style|onclick|javascript:/);
  const css=scopedPageCss('@import "https://example.test/style.css"; body {color:red} @media (width > 600px){.card{display:grid}} @keyframes spin{to{opacity:0}} .card{animation:spin 1s} @font-face{font-family:test;src:url(x)}','page-1');
  assert.match(css,/@scope \(\.managed-page\[data-page-id="page-1"\]\)/);assert.match(css,/:scope \{color:red\}/);assert.match(css,/@media/);assert.match(css,/page-page-1-spin/);assert.doesNotMatch(css,/@import|@font-face/);
});

test('dynamic slots keep archive boundaries, permissions, ordering and pagination',async()=>{
  const blog=saveFolder({name:'博客'}),topic=saveFolder({name:'技术',parentId:blog.id}),misc=saveFolder({name:'MISC'});saveSettings({...getSettings(),knowledgeRootId:blog.id});
  for(let i=0;i<16;i++)saveArticle({title:'文章 '+i,body:'内容',summary:'摘要',folderId:topic.id,status:'published'});
  saveArticle({title:'隐藏文章',body:'秘密',folderId:topic.id,status:'draft'});saveArticle({title:'私密文章',body:'秘密',folderId:topic.id,status:'published',access:'private'});
  for(let i=0;i<11;i++)saveArticle({title:'杂项 '+i,body:'内容',folderId:misc.id,status:'published'});
  const page={id:'archive',body:'<h1>自定义归档标题</h1><div data-page-slot="archive"></div>',route:'/knowledge',css:''};
  const first=load((await renderHtmlPage(page,admin)).html);assert.equal(first('.compact-article').length,15);assert.doesNotMatch(first.text(),/隐藏文章|私密文章|杂项/);
  const second=load((await renderHtmlPage(page,visitor,{page:'2',folder:topic.id,q:'文章',sort:'title'})).html);assert.equal(second('.compact-article').length,1);assert.equal(second('.pagination span').text(),'2 / 2');
  assert.equal(new URL(second('.pagination a').attr('href')!,'http://test').searchParams.get('q'),'文章');
  const collection=load((await renderHtmlPage({...page,body:'<div data-page-slot="collection"></div>',route:'/misc',collection:{folderId:misc.id,perPage:10}},visitor,{page:'2'})).html);assert.equal(collection('.article-card').length,1);assert.equal(collection('.pagination a').attr('href'),'/misc?page=1');
});

test('page routes reject reserved addresses and collisions including retained aliases',()=>{
  for(const route of ['//','//evil.test','/admin','/api/media','/posts/x','/search','/x?q=1','/x#y','/../x','/x\\y'])assert.equal(normalizePageRoute(route),null,route);
  assert.equal(normalizePageRoute('/example/'),'/example');
  saveArticle({title:'页面',kind:'page',contentFormat:'html',body:'<p>x</p>',route:'/example',aliases:['/old'],status:'published'});
  assert.throws(()=>saveArticle({title:'重复',kind:'page',contentFormat:'html',body:'',route:'/old',status:'published'}),/已有页面/);
  assert.throws(()=>saveArticle({title:'错误 CSS',kind:'page',contentFormat:'html',body:'',css:'a {',route:'/bad',status:'published'}),/CSS/);
});

test('migration retains the requested five pages, IDs, media and staged edits, and is idempotent',async()=>{
  const about=saveArticle({title:'About',kind:'page',body:'# About\n\n![图](/api/media/existing)',aliases:['/about'],status:'published'});
  const index=saveArticle({title:'Index',kind:'page',body:'过时的静态归档',aliases:['/index'],status:'published'});
  const links=saveArticle({title:'Links',kind:'page',body:'# Links\n\n[友链](https://example.test)',aliases:['/links'],giscusTerm:'旧评论关联',status:'published'});
  saveArticle({title:'MISC',kind:'page',body:'# MISC',aliases:['/misc'],template:'collection',collection:{folderId:'root',perPage:10},status:'published'});
  saveArticle({title:'Homepage',kind:'page',body:'英文首页',aliases:['/en'],status:'published'});saveArticle({title:'Projects',kind:'page',body:'项目',aliases:['/projects'],status:'published'});
  const post=saveArticle({title:'博客文章',body:'博客正文',status:'published'});
  saveEditorDraft(about.id,{...about,body:'# About\n\n**尚未发布**'},{baseVersion:about.version,draftVersion:null});
  const dry=await migratePages();assert.equal(dry.removed.length,2);assert.equal(listArticles().filter(a=>a.kind==='page').length,6);
  await migratePages(true);const pages=listArticles().filter(a=>a.kind==='page');assert.equal(pages.length,5);assert.equal(listTrash().length,2);
  assert.deepEqual(pages.map(a=>a.route).sort(),['/','/about','/knowledge','/links','/misc']);
  assert.equal(findArticle(about.id)!.route,'/about');assert.match(findArticle(about.id)!.body,/\/api\/media\/existing/);assert.equal(findArticle(links.id)!.giscusTerm,'旧评论关联');assert.match(findArticle(index.id)!.body,/data-page-slot="archive"/);
  const {readEditorDraft}=await import('../src/lib/editor-drafts');const draft=readEditorDraft(about.id)!;assert.equal(draft.baseVersion,findArticle(about.id)!.version);assert.match(draft.document.body,/<strong>尚未发布<\/strong>/);
  assert.equal(findArticle(post.id)!.body,post.body);const before=pages.map(p=>p.version).sort();assert.equal((await migratePages(true)).alreadyApplied,true);assert.deepEqual(listArticles().filter(a=>a.kind==='page').map(p=>p.version).sort(),before);
});

test('a restored or newly imported Markdown collection converts to editable HTML with its dynamic slot',async()=>{
  const legacy=saveArticle({title:'集合',kind:'page',body:'# 集合\n\n**介绍**',aliases:['/imported'],template:'collection',collection:{folderId:'root',perPage:3},status:'published'});
  const converted=await convertLegacyPage(legacy);assert.equal(converted.contentFormat,'html');assert.match(converted.body,/<strong>介绍<\/strong>/);assert.match(converted.body,/data-page-slot="collection"/);assert.equal(converted.collection?.perPage,3);assert.equal(converted.id,legacy.id);
});

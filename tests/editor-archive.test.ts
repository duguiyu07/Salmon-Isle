import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {load} from 'cheerio';
import {EditorState} from '@milkdown/kit/prose/state';
import {createTestEditor,equivalentVisualDocuments} from './helpers/visual-editor';
import {parseVisualMarkdown,serializeVisualMarkdown} from '../src/lib/visual-schema';
import {imageCaptionTransaction} from '../src/lib/visual-images';
import {codeLanguage,codeLanguages,recentLanguages} from '../src/lib/code-languages';
import {highlightCode} from '../src/components/code-highlight';
import {renderMarkdown} from '../src/lib/markdown';
import {repairImageCaptions} from '../src/lib/repair-captions';
import {analyzeWordPress} from '../src/lib/wordpress';
import {knowledgeData,folderArticles} from '../src/lib/public-data';
import {getSettings,saveSettings,saveFolder,saveArticle} from '../src/lib/storage';
import {closeDatabases} from '../src/lib/db';
import {archiveHref,paginate} from '../src/lib/pagination';
import {shortcutHref} from '../src/lib/styles';

let directory='';
beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-editor-archive-'));process.env.SALMON_DATA_DIR=directory;});
afterEach(()=>{closeDatabases();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'salmon-editor-archive-'));fs.rmSync(directory,{recursive:true,force:true});});
const visitor={admin:false,grants:new Set<string>()},admin={admin:true,grants:new Set<string>()};

test('shortcut cards render a single safe anchor while retaining formatted content',async()=>{
  const source=':::group{preset="shortcut" href="/links"}\n**卡片标题**\n\n说明与 [内层链接](https://example.test/inner) 和 <a href="/other">HTML 链接</a>。\n:::';
  const $=load((await renderMarkdown(source)).html);
  assert.equal($('a.shortcut-card').length,1);
  assert.equal($('a.shortcut-card').attr('href'),'/links');
  assert.equal($('a.shortcut-card a').length,0);
  assert.equal($('a.shortcut-card strong').text(),'卡片标题');
  assert.match($('a.shortcut-card').text(),/内层链接.*HTML 链接/);
  assert.equal(shortcutHref('https://example.test/\u0000'),undefined);
  for(const href of ['javascript:alert(1)','data:text/html,test','//evil.test','/\\evil.test']){
    assert.equal(shortcutHref(href),undefined,href);
    const html=(await renderMarkdown(':::group{preset="shortcut" href="'+href+'"}\n标题\n:::')).html;
    assert.equal(load(html)('a.shortcut-card').length,0);
  }
  for(const href of ['/posts/example','#section','../links','https://example.test/path','mailto:hello@example.test'])assert.equal(shortcutHref(href),href);
});

test('shortcut grid and destinations survive visual editing and explicit styles',async()=>{
  const setup=await createTestEditor();try{
    const source='::::group{preset="plain" layout="grid"}\n:::group{preset="shortcut" href="https://example.test" padding="24px"}\n**网站名称**\n\n网站说明\n:::\n::::';
    const markdown=setup.editor.action(ctx=>{
      const before=parseVisualMarkdown(ctx,source),serialized=serializeVisualMarkdown(ctx,before),after=parseVisualMarkdown(ctx,serialized);
      assert.ok(equivalentVisualDocuments(before,after));
      assert.equal(before.firstChild!.attrs.attributes.layout,'grid');
      assert.equal(before.firstChild!.firstChild!.attrs.attributes.href,'https://example.test');
      return serialized;
    });
    const $=load((await renderMarkdown(markdown)).html);
    assert.equal($('.layout-grid>a.shortcut-card').length,1);
    assert.equal($('a.shortcut-card').attr('href'),'https://example.test');
    assert.match($('a.shortcut-card').attr('style')||'',/padding:24px/);
    assert.equal($('a.shortcut-card').attr('target'),'_blank');
  }finally{await setup.close();}
});

test('all Shiki languages, names and aliases resolve consistently and recents are bounded',()=>{
  for(const [input,expected] of [['C','c'],['C++','cpp'],['Java','java'],['SQL','sql'],['JS','javascript'],['PlainText','text'],['no-such-language','text']])assert.equal(codeLanguage(input),expected,input);
  for(const language of codeLanguages){assert.equal(codeLanguage(language.id),language.id);assert.equal(codeLanguage(language.name),language.id);}
  assert.ok(codeLanguages.length>200);
  assert.deepEqual(recentLanguages(['c','java','bad','C','sql'],'C++'),['cpp','c','java','sql']);
  assert.equal(recentLanguages(codeLanguages.map(l=>l.id)).length,8);
});

test('public and editable code highlight uppercase languages without losing code options',async()=>{
  const source='#include <stdio.h>\nint main(void) { return 0; }';
  for(const language of ['C','C++','Java','SQL']){const $=load((await renderMarkdown('```'+language+' start=23 highlight="23" blur="24"\n'+source+'\n```')).html);assert.equal($('code').attr('data-language'),codeLanguage(language));assert.ok($('code span[style]').length>0);assert.equal($('[data-line-number="23"]').length,1);assert.equal($('[data-blurred-line]').attr('data-line-number'),'24');}
  const c=await highlightCode(source,'C');assert.ok(c.size>5);assert.equal((await highlightCode(source,'no-such-language')).size,0);
  assert.ok((await highlightCode('SELECT value FROM table_name;','SQL')).size>2);
});

test('green preset has identical defaults in the visual schema and published HTML, with explicit overrides',async()=>{
  const setup=await createTestEditor();try{
    const source=':::group{preset="green" padding="8px"}\n绿色 **内容**\n:::';
    const markdown=setup.editor.action(ctx=>{const doc=parseVisualMarkdown(ctx,source),out=serializeVisualMarkdown(ctx,doc);assert.ok(equivalentVisualDocuments(doc,parseVisualMarkdown(ctx,out)));return out;});
    const $=load((await renderMarkdown(markdown)).html);const style=$('.preset-green').attr('style')!;
    for(const value of ['background-color:#cee5bd','color:#111111','border-color:#315f25','border-width:1px','border-radius:3px','padding:8px','margin:20px 0','font-size:1.125rem','line-height:1.3'])assert.ok(style.includes(value),value);
  }finally{await setup.close();}
});

test('visual language changes preserve code text and metadata without normalizing untouched fences',async()=>{
  const setup=await createTestEditor();try{setup.editor.action(ctx=>{
    const source='```C start=23 highlight="24" blur="25"\nint value = 1;\n```';
    const doc=parseVisualMarkdown(ctx,source);assert.match(serializeVisualMarkdown(ctx,doc),/```C /);
    const state=EditorState.create({doc}),code=doc.firstChild!;
    const changed=state.apply(state.tr.setNodeMarkup(0,undefined,{...code.attrs,language:codeLanguage('Java')})).doc;
    assert.equal(changed.firstChild!.textContent,code.textContent);assert.equal(changed.firstChild!.attrs.meta,code.attrs.meta);
    assert.match(serializeVisualMarkdown(ctx,changed),/```java start=23 highlight="24" blur="25"/);
  });}finally{await setup.close();}
});

test('figures round trip nested rich captions and keep alt text separate from the description',async()=>{
  const setup=await createTestEditor();try{
    const source='::::group{preset="green"}\n:::figure\n[![替代文本](/api/media/local "图片标题")](https://example.test/image)\n\n关系型 **数据库** 与 [来源](https://example.test)。\n:::\n::::';
    const out=setup.editor.action(ctx=>{const before=parseVisualMarkdown(ctx,source),markdown=serializeVisualMarkdown(ctx,before);assert.ok(equivalentVisualDocuments(before,parseVisualMarkdown(ctx,markdown)));return markdown;});
    const $=load((await renderMarkdown(out)).html);assert.equal($('figure.content-figure').length,1);assert.equal($('figure img').attr('alt'),'替代文本');assert.equal($('figcaption strong').text(),'数据库');assert.equal($('figcaption a').attr('href'),'https://example.test');assert.equal($('figure>a').attr('href'),'https://example.test/image');
    const body=':::figure\n![](/image.png)\n\n<script>alert(1)</script>\n:::';assert.doesNotMatch((await renderMarkdown(body)).html,/<script|alert\(1\)/);
  }finally{await setup.close();}
});

test('adding and removing captions preserves the original image, link and alt attributes',async()=>{
  const setup=await createTestEditor();try{setup.editor.action(ctx=>{
    const doc=parseVisualMarkdown(ctx,'[![替代文字](/image.png "图片标题")](https://example.test/full)');
    const state=EditorState.create({doc});const tr=imageCaptionTransaction(state,1,'说明 **加粗**')!;assert.equal(tr.doc.firstChild?.type.name,'paragraph');assert.equal(tr.doc.nodeAt(1)!.attrs.caption,'说明 **加粗**');assert.equal(tr.doc.nodeAt(1)!.attrs.alt,'替代文字');assert.equal(tr.doc.nodeAt(1)!.marks[0].attrs.href,'https://example.test/full');
    const next=state.apply(tr);const removed=imageCaptionTransaction(next,1,'')!;assert.ok(removed.doc.eq(doc));
  });}finally{await setup.close();}
});

test('WordPress figures retain captions and legacy analysis stays available for safe repair',()=>{
  const html='<!-- wp:image --><figure><img src="https://old.test/a.png" alt="替代文字"/><figcaption>图片<strong>说明</strong>与<a href="https://example.test">链接</a></figcaption></figure><!-- /wp:image -->';
  const xml='<rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Source</title><link>https://old.test</link><wp:wxr_version>1.2</wp:wxr_version><item><title>Figure</title><wp:post_id>1</wp:post_id><wp:post_type>post</wp:post_type><content:encoded><![CDATA['+html+']]></content:encoded></item></channel></rss>';
  const fixed=analyzeWordPress(xml).candidates[0].body;assert.match(fixed,/:image\[/);assert.match(fixed,/\*\*说明\*\*/);assert.match(fixed,/\[链接\]/);assert.doesNotMatch(analyzeWordPress(xml,undefined,{legacyCaptions:true}).candidates[0].body,/:image\[/);
});

test('caption repair keeps localized and edited images, avoids wrappers, and is idempotent',()=>{
  const corrected='::::group{preset="green"}\n:::figure\n![原始 alt](https://old.test/a.png)\n\n关系 **趋势**\n:::\n::::';
  const current=':::group{preset="green"}\n![修改后的 alt](/api/media/local)\n\n关系 **趋势**\n:::\n\n作者新增正文';
  const result=repairImageCaptions(current,corrected);assert.equal(result.recovered,1);assert.equal(result.conflicts.length,0);assert.match(result.body,/^:::group/);assert.doesNotMatch(result.body,/:::figure/);assert.match(result.body,/修改后的 alt/);assert.match(result.body,/\/api\/media\/local/);assert.match(result.body,/作者新增正文/);
  const again=repairImageCaptions(result.body,corrected);assert.equal(again.changed,false);assert.equal(again.already,1);assert.equal(again.conflicts.length,0);
  const conflict=repairImageCaptions(current.replace('关系 **趋势**','作者改写的说明'),corrected);assert.equal(conflict.changed,false);assert.equal(conflict.conflicts.length,1);
  const ambiguous=repairImageCaptions(current+'\n\n![](/other.png)\n\n关系 **趋势**',corrected);assert.equal(ambiguous.changed,false);assert.equal(ambiguous.conflicts.length,1);
});

test('Index stays within the stable blog root while sidebar lists only the current folder in natural order',()=>{
  const blog=saveFolder({name:'博客'}),topic=saveFolder({name:'数据结构',parentId:blog.id}),child=saveFolder({name:'子目录',parentId:topic.id}),misc=saveFolder({name:'MISC'});
  saveSettings({...getSettings(),knowledgeRootId:blog.id});
  for(const title of ['第10章','第2章','第1章'])saveArticle({title,body:'正文',summary:'摘要',status:'published',folderId:topic.id});
  saveArticle({title:'权重优先',body:'正文',status:'published',folderId:topic.id,order:-1});
  saveArticle({title:'密码文章',body:'隐私',summary:'保密摘要',status:'published',folderId:topic.id,access:'password',password:'secret',order:10});
  saveArticle({title:'草稿',body:'正文',folderId:topic.id});saveArticle({title:'私密',body:'正文',status:'published',folderId:topic.id,access:'private'});
  saveArticle({title:'根目录文章',body:'正文',status:'published',folderId:blog.id});saveArticle({title:'下级文章',body:'正文',status:'published',folderId:child.id});saveArticle({title:'杂项',body:'正文',status:'published',folderId:misc.id});saveArticle({title:'站点根目录文章',body:'正文',status:'published'});
  for(const viewer of [visitor,admin]){
    const data=knowledgeData(viewer);assert.equal(data.articles.length,7);assert.ok(!data.articles.some(a=>['杂项','站点根目录文章','草稿','私密'].includes(a.title)));
    const related=folderArticles(topic.id,viewer);assert.deepEqual(related.map(a=>a.title),['权重优先','第1章','第2章','第10章','密码文章']);assert.equal(related.at(-1)?.summary,'');
  }
  saveFolder({...blog,name:'改名后的博客'});assert.equal(knowledgeData(visitor).articles.length,7);
  fs.writeFileSync(path.join(directory,'site.yml'),'knowledgeRootId: missing-root\n');assert.equal(knowledgeData(visitor).articles.length,0);
});

test('15 and 10 item pages normalize invalid bounds and preserve archive filters',()=>{
  const items=Array.from({length:16},(_,i)=>i);assert.equal(paginate(items,1,15).items.length,15);assert.deepEqual(paginate(items,2,15).items,[15]);assert.equal(paginate(items,'Infinity',15).current,1);assert.equal(paginate(items,-2,15).current,1);assert.equal(paginate(items,999,15).current,2);assert.equal(paginate([],3,15).current,1);
  assert.equal(paginate(items.slice(0,11),1,10).items.length,10);assert.equal(paginate(items.slice(0,11),2,10).items.length,1);
  const url=new URL(archiveHref(2,{folder:'topic',q:'中文 & SQL',sort:'title'}),'https://example.test');assert.equal(url.searchParams.get('q'),'中文 & SQL');assert.equal(url.searchParams.get('folder'),'topic');assert.equal(url.searchParams.get('sort'),'title');assert.equal(url.searchParams.get('page'),'2');
});

test('only the independent page main heading receives the handwritten title marker',async()=>{
  const $=load((await renderMarkdown(':::group{preset="plain"}\n# **MISC**\n:::\n\n# 正文分节',{pageTitle:true})).html);assert.equal($('.page-title').length,1);assert.equal($('.page-title strong').text(),'MISC');assert.equal($('h1').length,2);assert.equal(load((await renderMarkdown('# 文章标题')).html)('.page-title').length,0);
});

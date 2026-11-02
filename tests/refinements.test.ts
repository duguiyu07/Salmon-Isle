import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {load} from 'cheerio';
import {saveArticle,saveFolder,saveSettings,getSettings,listFolders,listArticles} from '../src/lib/storage';
import {publicData} from '../src/lib/public-data';
import {renderMarkdown} from '../src/lib/markdown';
import {analyzeWordPress,commitImport} from '../src/lib/wordpress';
import {parseCodeMeta,wordpressCodeMeta} from '../src/lib/code-block';
import {repairImportedBody} from '../src/lib/repair-import';
import {closeDatabases} from '../src/lib/db';
let directory='';
beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-round-two-'));process.env.SALMON_DATA_DIR=directory;});
afterEach(()=>{closeDatabases();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'salmon-round-two-'));fs.rmSync(directory,{recursive:true,force:true});});
const admin={admin:true,grants:new Set<string>()};const visitor={admin:false,grants:new Set<string>()};
const wxr=(body:string,kind='post')=>`<rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Source</title><link>https://example.test</link><wp:wxr_version>1.2</wp:wxr_version><wp:base_site_url>https://example.test</wp:base_site_url><wp:category><wp:term_id>55</wp:term_id><wp:category_nicename>misc</wp:category_nicename><wp:cat_name>MISC</wp:cat_name></wp:category><item><title>Fixture</title><wp:post_id>1</wp:post_id><wp:post_type>${kind}</wp:post_type><wp:post_name>misc</wp:post_name><wp:status>publish</wp:status><content:encoded><![CDATA[${body}]]></content:encoded></item></channel></rss>`;

test('public catalog hides drafts and inherited private articles even for administrators',()=>{
  const blog=saveFolder({name:'博客'}),child=saveFolder({name:'技术',parentId:blog.id}),hidden=saveFolder({name:'私密',parentId:blog.id,access:'private'}),misc=saveFolder({name:'MISC'});
  saveSettings({...getSettings(),knowledgeRootId:blog.id});
  saveArticle({title:'公开笔记',body:'正文',folderId:child.id,status:'published'});saveArticle({title:'草稿笔记',body:'草稿',folderId:child.id});saveArticle({title:'私密笔记',body:'秘密',folderId:hidden.id,status:'published',access:'public'});saveArticle({title:'杂项文章',body:'日常',folderId:misc.id,status:'published'});saveArticle({title:'页面',body:'页面正文',kind:'page',status:'published'});saveArticle({title:'锁定',body:'隐藏摘要',summary:'隐藏摘要',cover:'https://example.test/image.png',status:'published',access:'password',password:'secret'});
  for(const viewer of [admin,visitor]){const data=publicData(viewer);assert.deepEqual(data.articles.map(a=>a.title).sort(),['公开笔记','杂项文章','锁定'].sort());assert.deepEqual(data.folders.map(f=>f.id).sort(),['root',child.id].sort());assert.equal(data.folders.find(f=>f.id===child.id)?.parentId,'root');assert.equal(data.articles.find(a=>a.title==='锁定')?.locked,true);assert.equal(data.articles.find(a=>a.title==='锁定')?.summary,'');}
  saveFolder({...blog,name:'技术博客'});assert.ok(publicData(admin).folders.some(f=>f.id===child.id));
});

test('code lines use displayed numbers, highlight and permanently blur only requested rows',async()=>{
  const result=await renderMarkdown('```js start=23 highlight="24-25" blur="26"\na\nb\nc\nd\n```');const $=load(result.html);
  assert.equal($('code').attr('data-code-lines'),'true');assert.equal($('[data-line-number="23"]').length,1);assert.equal($('[data-highlighted-line]').length,2);assert.equal($('[data-blurred-line]').attr('data-line-number'),'26');assert.equal(decodeURIComponent($('pre').attr('data-code-source')!),'a\nb\nc\nd');
  const hidden=load((await renderMarkdown('```text lineNumbers=false\nplain\n```')).html);assert.equal(hidden('code').attr('data-code-lines'),'false');
});

test('bare colons in clock times are preserved in public Markdown',async()=>{const rendered=await renderMarkdown('截止 23:59，注意时间。');assert.match(rendered.html,/23:59/);});

test('WordPress code metadata preserves starts and converts non-blurred row semantics',()=>{
  const options=parseCodeMeta(wordpressCodeMeta({lineNumbers:false,startingLineNumber:'23',enableHighlighting:true,lineHighlights:'23,[25,26]',enableBlurring:true,lineBlurs:'[24,25]'},'a\nb\nc\nd\ne'));
  assert.deepEqual(options,{lineNumbers:false,start:23,highlight:'23,25,26',blur:'23,26,27'});
});

test('MathML converts to a single TeX expression and keeps matrix backslashes',async()=>{
  const latex='\\begin{pmatrix}a & b\\\\ c & d\\end{pmatrix}';
  const source=`<!-- wp:paragraph --><p>结果 <math data-latex="x^2"><semantics><msup><mi>x</mi><mn>2</mn></msup><annotation encoding="application/x-tex">x^2</annotation></semantics></math>；<math><semantics><mrow><mi>A</mi></mrow><annotation encoding="application/x-tex">${latex.replaceAll('&','&amp;')}</annotation></semantics></math>。</p><!-- /wp:paragraph --><!-- wp:katex/display-block --><div><pre>E=mc^2</pre></div><!-- /wp:katex/display-block -->`;
  const candidate=analyzeWordPress(wxr(source)).candidates[0];assert.ok(candidate.body.includes('$x^2$'));assert.ok(candidate.body.includes(`$${latex}$`));assert.ok(candidate.body.includes('$$\nE=mc^2\n$$'));assert.doesNotMatch(candidate.body,/x2x\^2|<math|annotation/);
  const $=load((await renderMarkdown(candidate.body)).html);assert.equal($('.katex').length,3);assert.equal($('.katex-error').length,0);
});

test('stored KaTeX HTML and MathJax TeX scripts are extracted once without executing scripts',async()=>{
  const body='<!-- wp:html --><p><span class="katex"><span class="katex-mathml"><math><annotation encoding="application/x-tex">a+b</annotation></math></span><span class="katex-html">DUPLICATE</span></span></p><script type="math/tex; mode=display">x=y</script><script>alert(1)</script><!-- /wp:html -->';const imported=analyzeWordPress(wxr(body)).candidates[0];assert.ok(imported.body.includes('$a+b$'));assert.ok(imported.body.includes('$$\nx=y\n$$'));assert.doesNotMatch(imported.body,/DUPLICATE|alert|<script/);assert.equal(load((await renderMarkdown(imported.body)).html)('.katex').length,2);
});

test('MathML without a TeX annotation is recovered structurally',async()=>{
  const body='<!-- wp:paragraph --><p>后继 <math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msub><mi>A</mi><mrow><mi>i</mi><mo>+</mo><mn>1</mn></mrow></msub></mrow></semantics></math>；<math><mrow><mi>n</mi><mo>≤</mo><mi>m</mi></mrow></math></p><!-- /wp:paragraph -->';const candidate=analyzeWordPress(wxr(body)).candidates[0];assert.match(candidate.body,/\$A_\{i\s*\+\s*1\}\$/);assert.equal(load((await renderMarkdown(candidate.body)).html)('.katex').length,2);
});

test('source repair keeps unrelated current edits and is idempotent',()=>{
  const old='标题\n\n正文 x2x^2。\n\n结尾';const fixed='标题\n\n正文 $x^2$。\n\n结尾';const current=old+'\n\n新加的内容';const first=repairImportedBody(current,old,fixed);assert.equal(first.conflicts.length,0);assert.match(first.body,/正文 \$x\^2\$。/);assert.match(first.body,/新加的内容/);const second=repairImportedBody(first.body,old,fixed);assert.equal(second.changed,false);assert.equal(second.conflicts.length,0);
  const conflict=repairImportedBody('标题\n\n作者已重新写过公式。\n\n结尾',old,fixed);assert.equal(conflict.changed,false);assert.equal(conflict.conflicts.length,1);
});

test('repair aligns repeated code fences to the source and preserves localized media',()=>{
  const before='```c\nfirst\n```\n\n![](https://old.test/image.png)\n\n```c\nsecond\n```';const after=before.replace('```c\nfirst','```c start=23\nfirst');const current=before.replace('https://old.test/image.png','/api/media/local');
  const result=repairImportedBody(current,before,after);assert.equal(result.conflicts.length,0);assert.match(result.body,/```c start=23\nfirst/);assert.match(result.body,/```c\nsecond/);assert.match(result.body,/\/api\/media\/local/);const again=repairImportedBody(result.body,before,after);assert.equal(again.changed,false);assert.equal(again.conflicts.length,0);
});

test('WordPress category queries become collection pages with stable folder IDs',()=>{
  const source='<!-- wp:heading {"level":1} --><h1>MISC</h1><!-- /wp:heading --><!-- wp:query {"query":{"postType":"post","perPage":10,"taxQuery":{"include":{"category":[55]}}}} --><div><!-- wp:post-template --><!-- wp:post-title /--><!-- /wp:post-template --></div><!-- /wp:query -->';const analysis=analyzeWordPress(wxr(source,'page'));const candidate=analysis.candidates[0];assert.equal(candidate.meta.template,'collection');assert.equal(candidate.collectionPath,'MISC');assert.doesNotMatch(candidate.body,/待处理/);commitImport(analysis,[{id:candidate.meta.id,selected:true}]);const page=listArticles()[0];assert.equal(page.collection?.folderId,listFolders().find(f=>f.path==='MISC')?.id);assert.equal(page.collection?.perPage,10);
});

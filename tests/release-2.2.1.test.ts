import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {folderOptions,importFolderOptions} from '../src/lib/folder-options';
import {RenderCache} from '../src/lib/render-cache';
import {publishedHref} from '../src/lib/admin-view';
import {OpenArticle} from '../src/components/open-article';
import {FolderOptions} from '../src/components/folder-options';
import {saveArticle,writeImportedArticle,articleMeta,invalidateLibraryCache} from '../src/lib/storage';
import {closeDatabases} from '../src/lib/db';
const {cleanupData}=createRequire(import.meta.url)('../deploy/cleanup-data.cjs');
const folders=[
  {id:'child',name:'甲',parentId:'b',path:'乙/甲',order:-9},
  {id:'b',name:'乙',parentId:'root',path:'乙',order:2},
  {id:'root',name:'所有文章',parentId:'',path:'',order:0},
  {id:'a',name:'甲',parentId:'root',path:'甲',order:1},
  {id:'leaf',name:'末级',parentId:'child',path:'乙/甲/末级',order:0},
];
test('folder selects match complete tree branches, sibling weights and path identities',()=>{
  const options=folderOptions(folders);assert.deepEqual(options.map(folder=>folder.id),['root','a','b','child','leaf']);
  assert.equal(options[3].depth,1);assert.equal(options[4].depth,2);assert.match(options[3].label,/^\u00a0\u00a0└ 甲$/);
  const html=renderToStaticMarkup(createElement('select',null,createElement(FolderOptions,{folders})));
  assert.match(html,/value="child" title="乙\/甲"/);assert.ok(html.indexOf('value="b"')<html.indexOf('value="child"'));
  const imported=importFolderOptions(folders,['乙/新建/子级']);assert.equal(imported.find(folder=>folder.path==='乙/新建/子级')?.depth,2);
  assert.deepEqual(imported.filter(folder=>['a','b','child'].includes(folder.id)).map(folder=>folder.id),['a','b','child']);
});
test('public opening uses the stored publication and disables unpublished articles and pages',()=>{
  assert.equal(publishedHref({id:'post',status:'published'}),'/posts/post');
  assert.equal(publishedHref({id:'page',kind:'page',route:'/about',status:'published'}),'/about');
  for(const kind of ['post','page']){
    const html=renderToStaticMarkup(createElement(OpenArticle,{article:{id:'draft',kind,status:'draft',route:'/unpublished'}}));
    assert.match(html,/<button[^>]*disabled/);assert.doesNotMatch(html,/href=|admin\/preview/);
  }
  const html=renderToStaticMarkup(createElement(OpenArticle,{article:{id:'post',status:'published'}}));
  assert.match(html,/target="_blank"/);assert.match(html,/rel="noopener noreferrer"/);assert.match(html,/href="\/posts\/post"/);
});
test('render cache coalesces in-flight work, evicts least recent and oversized values, and retries failures',async()=>{
  const cache=new RenderCache<string>(2,8);let calls=0;
  const render=()=>{calls++;return Promise.resolve('one');};
  const one=cache.get('one',render,value=>value.length);assert.equal(cache.get('one',render,value=>value.length),one);await one;assert.equal(calls,1);
  await cache.get('two',()=>Promise.resolve('two'),value=>value.length);
  await cache.get('one',render,value=>value.length);
  await cache.get('three',()=>Promise.resolve('six'),value=>value.length);
  await cache.get('one',render,value=>value.length);assert.equal(calls,1);
  await cache.get('two',render,value=>value.length);assert.equal(calls,2);
  const large=()=>{calls++;return Promise.resolve('oversized');};
  await cache.get('large',large,value=>value.length);await cache.get('large',large,value=>value.length);assert.equal(calls,4);
  let failed=0;const fail=async()=>{failed++;throw new Error('retry');};
  await assert.rejects(cache.get('bad',fail,()=>0),/retry/);await assert.rejects(cache.get('bad',fail,()=>0),/retry/);assert.equal(failed,2);
});
test('article saves and import replacements keep the latest file without creating history',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-no-history-')),previous=process.env.SALMON_DATA_DIR;
  process.env.SALMON_DATA_DIR=directory;invalidateLibraryCache();
  try{
    let article=saveArticle({title:'文章',body:'初版',status:'published'});article=saveArticle({...article,body:'新版'});
    const imported=writeImportedArticle(articleMeta(article),'导入替换','root',true);assert.match(imported.body,/导入替换/);
    assert.equal(fs.existsSync(path.join(directory,'history')),false);assert.equal(fs.readdirSync(path.join(directory,'content')).length,1);
  }finally{closeDatabases();invalidateLibraryCache();if(previous===undefined)delete process.env.SALMON_DATA_DIR;else process.env.SALMON_DATA_DIR=previous;fs.rmSync(directory,{recursive:true,force:true});}
});
test('cleanup requires a completed migration and preserves every active article and draft',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-cleanup-'));
  try{
    fs.mkdirSync(path.join(directory,'history'));fs.writeFileSync(path.join(directory,'history','old.md'),'old');
    assert.throws(()=>cleanupData(directory,true),/migration/);assert.ok(fs.existsSync(path.join(directory,'history','old.md')));
    fs.writeFileSync(path.join(directory,'direct-library.json'),JSON.stringify({version:2}));
    const active=path.join(directory,'library-v2');fs.mkdirSync(active);fs.writeFileSync(path.join(active,'library.json'),JSON.stringify({version:1}));
    for(const dir of ['content','media','media-meta','editor-drafts','trash'])fs.mkdirSync(path.join(active,dir));
    fs.writeFileSync(path.join(active,'content','live.md'),'LIVE');fs.writeFileSync(path.join(active,'editor-drafts','draft.json'),'DRAFT');
    fs.writeFileSync(path.join(directory,'site.yml'),'SETTINGS');
    const preview=cleanupData(directory);assert.equal(preview.applied,false);assert.ok(fs.existsSync(path.join(directory,'history')));
    const result=cleanupData(directory,true);assert.equal(result.bytes,3);assert.equal(fs.existsSync(path.join(directory,'history')),false);
    assert.equal(fs.readFileSync(path.join(active,'content','live.md'),'utf8'),'LIVE');assert.equal(fs.readFileSync(path.join(active,'editor-drafts','draft.json'),'utf8'),'DRAFT');assert.equal(fs.readFileSync(path.join(directory,'site.yml'),'utf8'),'SETTINGS');
    const outside=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-cleanup-outside-'));
    try{fs.writeFileSync(path.join(outside,'keep'),'KEEP');fs.symlinkSync(outside,path.join(directory,'history'),process.platform==='win32'?'junction':'dir');assert.throws(()=>cleanupData(directory,true),/symlink/);assert.equal(fs.readFileSync(path.join(outside,'keep'),'utf8'),'KEEP');}finally{if(fs.existsSync(path.join(directory,'history')))fs.unlinkSync(path.join(directory,'history'));fs.rmSync(outside,{recursive:true,force:true});}
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

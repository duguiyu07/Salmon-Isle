import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {git,createEmptyLibrary,initializeRepository,commitAndPush} from '../src/lib/content-repository';
import {withWorkspace,workspaceRoot} from '../src/lib/library-context';
import {saveArticle,findArticle} from '../src/lib/storage';
import {hashPassword} from '../src/lib/crypto';
import {closeDatabases} from '../src/lib/db';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-git-http-')),remote=path.join(root,'remote.git'),client=path.join(root,'desktop');
process.env.SALMON_DATA_DIR=path.join(root,'desktop-runtime');process.env.SALMON_CONTENT_REPO_DIR=client;process.env.SALMON_CONTENT_REMOTE=remote;process.env.SALMON_CONTENT_BRANCH='main';process.env.SALMON_ALLOW_LOCAL_GIT='true';process.env.SALMON_DESKTOP='true';
const port=await new Promise<number>(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=(server.address() as net.AddressInfo).port;server.close(()=>resolve(port));});}),origin='http://127.0.0.1:'+port,password='isolated-content-sync-password';
let child:ReturnType<typeof spawn>|undefined,logs='';
async function request(route:string,body?:unknown,cookie='',method='POST'){
  return fetch(origin+route,body===undefined?{headers:cookie?{Cookie:cookie}:{},redirect:'manual'}:{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body),redirect:'manual'});
}
async function ok(response:Response){const value=await response.json();assert.equal(response.ok,true,JSON.stringify(value));return value;}
async function waitFor(check:()=>Promise<boolean>,label:string){for(let i=0;i<120;i++){if(await check())return;assert.equal(child?.exitCode,null,logs);await new Promise(resolve=>setTimeout(resolve,250));}throw new Error(label+' timed out: '+logs);}
try{
  await git(['init','--bare','--initial-branch=main',remote],{cwd:root});await createEmptyLibrary(client);await initializeRepository({workspace:client,remote,branch:'main',siteUrl:''});
  const article=withWorkspace(()=>saveArticle({title:'Git HTTP published',body:'ORIGINAL_PUBLISHED_BODY',status:'published'}));await commitAndPush('initial','http-initial');
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:process.cwd(),env:{...process.env,SALMON_DATA_DIR:path.join(root,'server-runtime'),SALMON_CONTENT_REPO_DIR:path.join(root,'server-workspace'),SALMON_DESKTOP:'false',SALMON_ORIGIN:origin,SALMON_ADMIN_HASH:hashPassword(password),SALMON_SECURE_COOKIES:'false',SALMON_SYNC_INTERVAL_MS:'5000',NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout?.on('data',value=>logs+=value);child.stderr?.on('data',value=>logs+=value);
  await waitFor(async()=>{try{const r=await request('/api/health');return r.ok&&!!(await r.json()).contentRevision;}catch{return false;}},'initial sync');
  assert.match(await (await request('/posts/'+article.id)).text(),/ORIGINAL_PUBLISHED_BODY/);
  assert.equal((await request('/api/admin/git/status')).status,401);
  const login=await request('/api/login',{password}),cookie=login.headers.get('set-cookie')?.split(';')[0]||'';assert.ok(cookie);
  const form=new FormData();form.set('file',new Blob([Buffer.from([137,80,78,71])],{type:'image/png'}),'new-media.png');
  const media=await ok(await fetch(origin+'/api/admin/media',{method:'POST',headers:{Origin:origin,Cookie:cookie},body:form}));
  assert.equal((await request('/api/media/'+media.id+'?workspace=1')).status,401);assert.equal((await request('/api/media/'+media.id+'?workspace=1',undefined,cookie)).status,200);assert.equal((await request('/api/media/'+media.id)).status,404);
  const state=await ok(await request('/api/admin/state',undefined,cookie)),current=state.articles.find((value:any)=>value.id===article.id);assert.equal('media'in state,false);
  const page=await ok(await request('/api/admin/media?page=999&usage=unused',undefined,cookie));assert.equal(page.page,1);assert.equal(page.pageSize,24);assert.equal(page.total,1);
  const program=await request('/api/program-info');assert.equal(program.headers.get('access-control-allow-origin'),'*');assert.equal(typeof (await program.json()).version,'string');
  const draft=await ok(await request('/api/admin/editor-drafts',{articleId:article.id,document:{...current,body:'PREPARED_NEW_BODY\n\n![new](/api/media/'+media.id+'?article='+article.id+')'},baseVersion:current.version,draftVersion:null},cookie));
  await ok(await request('/api/admin/editor-drafts/'+article.id+'/push',{baseVersion:draft.article.version,draftVersion:draft.draft.draftVersion},cookie));
  assert.match(await (await request('/posts/'+article.id)).text(),/ORIGINAL_PUBLISHED_BODY/);assert.doesNotMatch(await (await request('/posts/'+article.id)).text(),/PREPARED_NEW_BODY/);
  assert.match(await (await request('/admin/preview/'+article.id,undefined,cookie)).text(),/PREPARED_NEW_BODY/);
  const committed=await ok(await request('/api/admin/git/commit',{message:'HTTP publication',operationId:randomUUID()},cookie));assert.equal((await ok(await request('/api/health'))).contentRevision,committed.sha);
  assert.match(await (await request('/posts/'+article.id)).text(),/PREPARED_NEW_BODY/);assert.equal((await request('/api/media/'+media.id+'?article='+article.id)).status,200);
  const references=await ok(await request('/api/admin/media/'+media.id+'/references',undefined,cookie));assert.ok(references.length);assert.equal((await request('/api/admin/media/'+media.id,{},cookie,'DELETE')).status,409);
  assert.equal((await request(references[0].href)).status,404);assert.match(await (await request(references[0].href,undefined,cookie)).text(),/PREPARED_NEW_BODY/);
  // A commit from another client is applied by the real server timer.
  const {synchronizeRepository}=await import('../src/lib/content-repository');await synchronizeRepository(true);
  const local=withWorkspace(()=>findArticle(article.id)!);withWorkspace(()=>saveArticle({...local,body:'EXTERNAL_DESKTOP_COMMIT',status:'published'}));const pushed=await commitAndPush('external desktop','http-external');
  await waitFor(async()=>(await ok(await request('/api/health'))).contentRevision===pushed.sha,'automatic remote sync');assert.match(await (await request('/posts/'+article.id)).text(),/EXTERNAL_DESKTOP_COMMIT/);
  const incoming=await ok(await request('/api/admin/git/status',undefined,cookie));assert.equal(incoming.phase,'synced');assert.ok(incoming.behind>0,'public activation must not replace an open admin worktree');assert.equal((await request('/api/media/'+media.id+'?article='+article.id)).status,404);
  console.log('Git HTTP smoke passed: protected API, staged publication, workspace preview, media authorization, atomic activation, and automatic external sync.');
}finally{if(child&&child.exitCode===null){child.kill();await new Promise<void>(resolve=>child!.once('exit',()=>resolve()));}closeDatabases();fs.rmSync(root,{recursive:true,force:true});}

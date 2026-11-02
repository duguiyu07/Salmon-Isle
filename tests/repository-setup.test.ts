import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {git} from '../src/lib/content-repository';
import {prepareRepositorySetup,applyRepositorySetup,getRepositorySetup} from '../src/lib/repository-setup';
import {runtimeDir,repositoryConfig,activeRevision,withLibrary,withPublicLibrary} from '../src/lib/library-context';
import {saveArticle,findArticle} from '../src/lib/storage';
import {addMedia} from '../src/lib/media';
import {closeDatabases} from '../src/lib/db';
const previous={...process.env};let root:string,remote:string;
beforeEach(async()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-setup-'));remote=path.join(root,'remote.git');
  for(const key of Object.keys(process.env))if(key.startsWith('SALMON_CONTENT_'))delete process.env[key];
  process.env.SALMON_DATA_DIR=path.join(root,'runtime');process.env.SALMON_ALLOW_LOCAL_GIT='true';process.env.SALMON_DESKTOP='false';Object.assign(process.env,{NODE_ENV:'test'});
  fs.mkdirSync(runtimeDir(),{recursive:true});await git(['init','--bare','--initial-branch=main',remote],{cwd:root});
  withLibrary(runtimeDir(),()=>{saveArticle({title:'Website original',body:'Keep website data',status:'published'});addMedia('original.png',Buffer.from('image'));});
});
afterEach(()=>{closeDatabases();for(const key of Object.keys(process.env))if(key.startsWith('SALMON_'))delete process.env[key];Object.assign(process.env,Object.fromEntries(Object.entries(previous).filter(([key])=>key.startsWith('SALMON_'))));Object.assign(process.env,{NODE_ENV:previous.NODE_ENV});assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'salmon-setup-'));fs.rmSync(root,{recursive:true,force:true});});
async function settled(id:string){const end=Date.now()+25000;for(;;){const result=getRepositorySetup(id).job!;if(!['preparing','applying'].includes(result.phase))return result;if(Date.now()>end)throw new Error('setup timed out: '+JSON.stringify(result));await new Promise(resolve=>setTimeout(resolve,30));}}
async function prepare(){const result=await prepareRepositorySetup({remote,manual:true});return settled(result.id);}
test('website setup previews without activation then backs up, pushes once, and activates the complete snapshot',async()=>{
  const preview=await prepare();assert.equal(preview.phase,'review',preview.error);assert.equal(repositoryConfig(),null);assert.equal(activeRevision(),null);assert.ok(preview.changes!.length);assert.equal(preview.summary!.media,1);
  const original=fs.readFileSync(path.join(runtimeDir(),'content',fs.readdirSync(path.join(runtimeDir(),'content'))[0]),'utf8');
  await applyRepositorySetup(preview.id);const done=await settled(preview.id);assert.equal(done.phase,'done',done.error);assert.ok(fs.existsSync(done.backup!));assert.equal(activeRevision(),done.sha);
  assert.equal(withPublicLibrary(()=>findArticle(original.match(/id: ([^\n]+)/)![1])?.title),'Website original');
  assert.equal(fs.readFileSync(path.join(runtimeDir(),'content',fs.readdirSync(path.join(runtimeDir(),'content'))[0]),'utf8'),original);
  assert.equal((await git(['rev-list','--count','HEAD'],{cwd:done.config.workspace})).stdout.toString().trim(),'1');
  await applyRepositorySetup(preview.id);assert.equal((await git(['rev-list','--count','HEAD'],{cwd:done.config.workspace})).stdout.toString().trim(),'1');
});
test('preflight rejects unrelated project files without changing website or remote history',async()=>{
  const seed=path.join(root,'seed');fs.mkdirSync(seed);await git(['init','--initial-branch=main'],{cwd:seed});fs.writeFileSync(path.join(seed,'package.json'),'{}');
  await git(['add','.'],{cwd:seed});await git(['-c','user.name=Test','-c','user.email=test@example.test','commit','-m','another project'],{cwd:seed});
  await git(['remote','add','origin',remote],{cwd:seed});await git(['push','origin','HEAD:main'],{cwd:seed});
  const job=await prepare();assert.equal(job.phase,'error');assert.match(job.error!,/其他项目文件/);assert.equal(repositoryConfig(),null);assert.equal(activeRevision(),null);
});
test('new website edits after preflight stop migration and keep the new input',async()=>{
  const job=await prepare();assert.equal(job.phase,'review',job.error);
  withLibrary(runtimeDir(),()=>saveArticle({title:'Newer input',body:'Must not be lost'}));
  await applyRepositorySetup(job.id);const result=await settled(job.id);assert.equal(result.phase,'error');assert.match(result.error!,/发生了变化/);assert.equal(repositoryConfig(),null);assert.equal(activeRevision(),null);
});
test('failed setup pushes reuse the original migration commit and backup on retry',async()=>{
  const job=await prepare();assert.equal(job.phase,'review',job.error);
  const work=path.join(runtimeDir(),'library-setup',job.id,'work');await git(['config','remote.origin.pushurl',path.join(root,'missing.git')],{cwd:work});
  await applyRepositorySetup(job.id);const failed=await settled(job.id);assert.equal(failed.phase,'error');assert.ok(failed.sha);assert.equal(repositoryConfig(),null);
  await git(['config','--unset','remote.origin.pushurl'],{cwd:work});await applyRepositorySetup(job.id);const done=await settled(job.id);
  assert.equal(done.phase,'done',done.error);assert.equal(done.sha,failed.sha);assert.equal(done.backup,failed.backup);assert.equal(activeRevision(),done.sha);
});
test('an existing remote README and its history survive website migration',async()=>{
  const seed=path.join(root,'seed');fs.mkdirSync(seed);await git(['init','--initial-branch=main'],{cwd:seed});fs.writeFileSync(path.join(seed,'README.md'),'Keep this repository history');
  await git(['add','.'],{cwd:seed});await git(['-c','user.name=Test','-c','user.email=test@example.test','commit','-m','existing repository'],{cwd:seed});
  const before=(await git(['rev-parse','HEAD'],{cwd:seed})).stdout.toString().trim();await git(['remote','add','origin',remote],{cwd:seed});await git(['push','origin','HEAD:main'],{cwd:seed});
  const preview=await prepare();assert.equal(preview.phase,'review',preview.error);await applyRepositorySetup(preview.id);const done=await settled(preview.id);assert.equal(done.phase,'done',done.error);
  assert.equal((await git(['rev-parse','HEAD^'],{cwd:done.config.workspace})).stdout.toString().trim(),before);assert.equal(fs.readFileSync(path.join(done.config.workspace,'README.md'),'utf8'),'Keep this repository history');
});
test('retry replaces an interrupted partial candidate before activation',async()=>{
  const preview=await prepare();assert.equal(preview.phase,'review',preview.error);
  const staging=preview.config.workspace+'.setup-'+preview.id;fs.mkdirSync(staging,{recursive:true});fs.writeFileSync(path.join(staging,'library.json'),'incomplete');
  await applyRepositorySetup(preview.id);const done=await settled(preview.id);assert.equal(done.phase,'done',done.error);assert.equal(activeRevision(),done.sha);
});

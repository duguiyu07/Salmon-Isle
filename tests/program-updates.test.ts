import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {saveProgramUpdateSettings,checkProgramUpdates,programUpdateStatus,programInfo} from '../src/lib/application-updates';
const {createUpdates}=createRequire(import.meta.url)('../desktop/updates.cjs');
const previous={...process.env};let root:string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-updates-'));process.env.SALMON_DATA_DIR=root;delete process.env.SALMON_DESKTOP;delete process.env.SALMON_RELEASE_MANIFEST_URL;delete process.env.SALMON_RELEASE_REPOSITORY;});
afterEach(()=>{for(const key of Object.keys(process.env))if(key.startsWith('SALMON_'))delete process.env[key];Object.assign(process.env,Object.fromEntries(Object.entries(previous).filter(([key])=>key.startsWith('SALMON_'))));assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'salmon-updates-'));fs.rmSync(root,{recursive:true,force:true});});

test('release defaults use Salmon Isle and preserve environment and saved overrides',()=>{
  const base='https://github.com/duguiyu07/Salmon-Isle/releases/latest/download/';
  assert.equal(programUpdateStatus().manifestUrl,base+'release.json');
  assert.equal(programInfo().desktopFeed,base);
  process.env.SALMON_RELEASE_REPOSITORY='example/fork';
  assert.equal(programUpdateStatus().manifestUrl,'https://github.com/example/fork/releases/latest/download/release.json');
  process.env.SALMON_RELEASE_MANIFEST_URL='https://updates.test/custom.json';
  assert.equal(programUpdateStatus().manifestUrl,'https://updates.test/custom.json');
  saveProgramUpdateSettings('https://saved.test/release.json');
  assert.equal(programUpdateStatus().manifestUrl,'https://saved.test/release.json');
});
test('website update checks validate release data and keep content settings separate',async t=>{
  saveProgramUpdateSettings('https://releases.test/release.json');
  t.mock.method(globalThis,'fetch',async()=>Response.json({version:'99.0.0',notesUrl:'https://releases.test/notes',desktopFeed:'https://releases.test/desktop/',dockerImage:'ghcr.io/owner/source:99.0.0'}));
  assert.equal((await checkProgramUpdates()).available,true);assert.equal(programInfo().desktopFeed,'https://releases.test/desktop/');
  assert.equal(fs.existsSync(path.join(root,'site.yml')),false);assert.throws(()=>saveProgramUpdateSettings('http://insecure.test'),/HTTPS/);
});
test('website update checks reject executable links and do not downgrade',async t=>{
  saveProgramUpdateSettings('https://releases.test/invalid.json');
  const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json({version:'99.0.0',notesUrl:'javascript:alert(1)'}));
  await assert.rejects(()=>checkProgramUpdates(),/HTTPS/);assert.equal(programUpdateStatus().available,false);
  fetch.mock.mockImplementation(async()=>Response.json({version:'0.1.0',notesUrl:'https://releases.test/notes'}));
  assert.equal((await checkProgramUpdates()).available,false);
});
test('desktop update flow preserves publisher verification and saves before installation',async()=>{
  const updater:any=new EventEmitter();let saved=false,installed=false;
  updater.setFeedURL=()=>{};updater.checkForUpdates=async()=>{updater.emit('checking-for-update');updater.emit('update-available',{version:'1.2.0'});};
  updater.downloadUpdate=async()=>{updater.emit('download-progress',{percent:35});updater.emit('update-downloaded',{version:'1.2.0'});};
  updater.quitAndInstall=()=>{assert.equal(saved,true);installed=true;};
  const config=path.join(root,'packaged.yml');fs.writeFileSync(config,JSON.stringify({publisherName:['Salmon Publisher']}));
  const updates=createUpdates({app:{getPath:()=>root,getVersion:()=>'1.1.0',isPackaged:true},updater,packagedConfigPath:config,saveBeforeInstall:async()=>{saved=true;}});
  await assert.rejects(()=>updates.check('file:///installer.exe'),/HTTPS/);
  assert.equal((await updates.check('https://releases.test/desktop')).phase,'available');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'update-provider.yml'),'utf8')).publisherName,['Salmon Publisher']);
  assert.equal((await updates.download()).phase,'ready');await updates.install();assert.equal(installed,true);
  assert.equal(fs.existsSync(path.join(root,'content')),false);
});
test('an unsaved editor blocks installation and permits retry without another download',async()=>{
  const updater:any=new EventEmitter();let fail=true,installs=0;
  updater.setFeedURL=()=>{};updater.checkForUpdates=async()=>updater.emit('update-available',{version:'1.2.0'});
  updater.downloadUpdate=async()=>updater.emit('update-downloaded',{version:'1.2.0'});updater.quitAndInstall=()=>installs++;
  const updates=createUpdates({app:{getPath:()=>root,getVersion:()=>'1.1.0',isPackaged:true},updater,saveBeforeInstall:async()=>{if(fail)throw new Error('编辑稿版本冲突');}});
  await updates.check('https://releases.test/');await updates.download();await assert.rejects(()=>updates.install(),/编辑稿/);
  assert.equal(installs,0);assert.equal(updates.status().phase,'ready');fail=false;await updates.install();assert.equal(installs,1);
});

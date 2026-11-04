import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {saveProgramUpdateSettings,checkProgramUpdates,programUpdateStatus,programInfo} from '../src/lib/application-updates';
const previous={...process.env};let root:string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-updates-'));process.env.SALMON_DATA_DIR=root;delete process.env.SALMON_DESKTOP;delete process.env.SALMON_RELEASE_MANIFEST_URL;delete process.env.SALMON_RELEASE_REPOSITORY;});
afterEach(()=>{for(const key of Object.keys(process.env))if(key.startsWith('SALMON_'))delete process.env[key];Object.assign(process.env,Object.fromEntries(Object.entries(previous).filter(([key])=>key.startsWith('SALMON_'))));assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'salmon-updates-'));fs.rmSync(root,{recursive:true,force:true});});

test('release defaults use Salmon Isle and preserve environment and saved overrides',()=>{
  const base='https://github.com/duguiyu07/Salmon-Isle/releases/latest/download/';
  assert.equal(programUpdateStatus().manifestUrl,base+'release.json');
  assert.equal('desktopFeed' in programInfo(),false);assert.equal('syncProtocol' in programInfo(),false);
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
  assert.equal((await checkProgramUpdates()).available,true);assert.equal('desktopFeed' in programInfo(),false);
  assert.equal(fs.existsSync(path.join(root,'site.yml')),false);assert.throws(()=>saveProgramUpdateSettings('http://insecure.test'),/HTTPS/);
});
test('website update checks reject executable links and do not downgrade',async t=>{
  saveProgramUpdateSettings('https://releases.test/invalid.json');
  const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json({version:'99.0.0',notesUrl:'javascript:alert(1)'}));
  await assert.rejects(()=>checkProgramUpdates(),/HTTPS/);assert.equal(programUpdateStatus().available,false);
  fetch.mock.mockImplementation(async()=>Response.json({version:'0.1.0',notesUrl:'https://releases.test/notes'}));
  assert.equal((await checkProgramUpdates()).available,false);
});

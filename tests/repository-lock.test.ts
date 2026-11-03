import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {withRepositoryLock} from '../src/lib/repository-lock';
import {runtimeDir} from '../src/lib/library-context';
import {backupData,restoreData} from '../src/lib/backup';
import {closeDatabases} from '../src/lib/db';

test('a runtime with a protected parent can lock, back up and restore without a stale lock',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-runtime-lock-'));
  const previous=process.env.SALMON_DATA_DIR;
  process.env.SALMON_DATA_DIR=path.join(root,'runtime');
  fs.mkdirSync(runtimeDir());
  if(process.platform!=='win32')fs.chmodSync(root,0o500);
  try{
    const restored=path.join(runtimeDir(),'restored');
    const backup=await withRepositoryLock(async()=>{
      assert.equal(fs.existsSync(runtimeDir()+'.salmon-lock'),false);
      assert.equal(fs.existsSync(path.join(runtimeDir(),'runtime.salmon-lock')),true);
      assert.equal(await withRepositoryLock(()=>'nested operation',runtimeDir()),'nested operation');
      return backupData();
    },runtimeDir());
    assert.equal(fs.existsSync(path.join(runtimeDir(),'runtime.salmon-lock')),false);
    restoreData(backup,restored);
    assert.equal(fs.existsSync(path.join(restored,'runtime.salmon-lock')),false);
    assert.equal(fs.existsSync(path.join(restored,'state.sqlite')),true);
  }finally{
    closeDatabases();
    if(previous===undefined)delete process.env.SALMON_DATA_DIR;else process.env.SALMON_DATA_DIR=previous;
    if(process.platform!=='win32')fs.chmodSync(root,0o700);
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'salmon-runtime-lock-'));
    fs.rmSync(root,{recursive:true,force:true});
  }
});

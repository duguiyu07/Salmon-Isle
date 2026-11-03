import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('deployed legacy lock operations stay exclusive inside writable data with NODE_OPTIONS',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-lock-hotfix-'));
  const runtime=path.join(root,'data');fs.mkdirSync(runtime);
  const patch=path.resolve('deploy/runtime-lock-hotfix.cjs');
  const script=`
    const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
    const runtime=process.env.SALMON_DATA_DIR;
    const legacy=path.resolve(runtime)+'.salmon-lock';
    const actual=path.join(runtime,'library-setup','runtime.salmon-lock');
    const fd=fs.openSync(legacy,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.closeSync(fd);
    assert.equal(fs.existsSync(legacy),false);
    assert.equal(fs.existsSync(actual),true);
    assert.equal(JSON.parse(fs.readFileSync(legacy,'utf8')).pid,process.pid);
    assert.throws(()=>fs.openSync(legacy,'wx'),error=>error.code==='EEXIST');
    fs.unlinkSync(legacy);assert.equal(fs.existsSync(actual),false);
    const normal=path.join(runtime,'unrelated.txt');
    fs.writeFileSync(normal,'keep ordinary files');
    const reader=fs.openSync(normal,'r');
    assert.equal(fs.readFileSync(reader,'utf8'),'keep ordinary files');fs.closeSync(reader);
    fs.unlinkSync(normal);assert.equal(fs.existsSync(normal),false);
    const otherLock=path.join(runtime,'content-repository.salmon-lock');
    const otherFd=fs.openSync(otherLock,'wx');fs.closeSync(otherFd);
    assert.equal(fs.existsSync(otherLock),true);fs.unlinkSync(otherLock);
  `;
  if(process.platform!=='win32')fs.chmodSync(root,0o500);
  try{
    const result=spawnSync(process.execPath,['-e',script],{
      env:{...process.env,SALMON_DATA_DIR:runtime,NODE_OPTIONS:'--require='+JSON.stringify(patch)},
      encoding:'utf8',windowsHide:true,timeout:10000,
    });
    assert.equal(result.error,undefined);
    assert.equal(result.status,0,result.stderr);
  }finally{
    if(process.platform!=='win32')fs.chmodSync(root,0o700);
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'salmon-lock-hotfix-'));
    fs.rmSync(root,{recursive:true,force:true});
  }
});

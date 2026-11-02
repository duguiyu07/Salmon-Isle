import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {git} from '../src/lib/content-repository';
test('bundled credential helpers accept spaces and literal shell characters without executing path text',async()=>{
  const previous={...process.env},root=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-helper-'));
  const folder=path.join(root,"Git Helper's $literal"),helper=path.join(folder,'credential helper.sh');fs.mkdirSync(folder);
  fs.writeFileSync(helper,"#!/bin/sh\nprintf '%s\\n' 'username=fixture-user' 'password=fixture-password'\n",{mode:0o700});
  process.env.SALMON_DESKTOP='true';process.env.SALMON_DATA_DIR=path.join(root,'runtime');process.env.SALMON_GIT_CREDENTIAL_MANAGER=helper;
  try{
    const result=await git(['credential','fill'],{cwd:root,input:'protocol=https\nhost=fixture.invalid\n\n'});
    assert.match(result.stdout.toString(),/username=fixture-user/);assert.match(result.stdout.toString(),/password=fixture-password/);
    assert.equal(fs.existsSync(path.join(root,'literal')),false);
  }finally{
    for(const key of Object.keys(process.env))if(key.startsWith('SALMON_'))delete process.env[key];Object.assign(process.env,Object.fromEntries(Object.entries(previous).filter(([key])=>key.startsWith('SALMON_'))));
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'salmon-helper-'));fs.rmSync(root,{recursive:true,force:true});
  }
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
function runUpdate(fail:boolean){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-update-script-')),scripts=path.join(root,'scripts'),log=path.join(root,'docker.log');
  fs.mkdirSync(scripts);fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data','content.txt'),'Offline content 你好');
  const originalEnv='SALMON_WEB_IMAGE=ghcr.io/owner/source:1.0.0\nSALMON_ADMIN_HASH=keep-this-setting\n';fs.writeFileSync(path.join(root,'.env'),originalEnv);
  fs.copyFileSync('scripts/update-site.ps1',path.join(scripts,'update-site.ps1'));
  const quote=(value:string)=>"'"+value.replaceAll("'","''")+"'";
  const stub=[
    'function global:docker {',
    '  $line=$args -join " ";$global:LASTEXITCODE=0',
    '  Add-Content -LiteralPath '+quote(log)+' -Value $line',
    '  if($line -eq "compose images -q blog") { Write-Output "sha256:old-image";return }',
    '  if($line -eq "compose config --format json") { Write-Output '+quote('{"services":{"blog":{"image":"ghcr.io/owner/source:1.0.0"}}}')+';return }',
    fail?'  if($line -like "compose up *") { $global:LASTEXITCODE=1;return }':'',
    '}',
    '& '+quote(path.join(scripts,'update-site.ps1'))+' -Image ghcr.io/owner/source:2.0.0'
  ].join('\n');
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',stub],{encoding:'utf8',windowsHide:true});
  return {root,result,log,originalEnv};
}
test('website update script backs up persistent data and preserves unrelated deployment settings',{skip:process.platform!=='win32'},()=>{
  const run=runUpdate(false);
  try{
    assert.equal(run.result.status,0,run.result.stderr);assert.equal(fs.readFileSync(path.join(run.root,'data/content.txt'),'utf8'),'Offline content 你好');
    const backup=path.join(run.root,'backups',fs.readdirSync(path.join(run.root,'backups'))[0]);assert.equal(fs.readFileSync(path.join(backup,'data/content.txt'),'utf8'),'Offline content 你好');
    const env=fs.readFileSync(path.join(run.root,'.env'),'utf8');assert.match(env,/SALMON_WEB_IMAGE=ghcr.io\/owner\/source:2.0.0/);assert.match(env,/SALMON_ADMIN_HASH=keep-this-setting/);
    assert.match(fs.readFileSync(run.log,'utf8'),/compose up -d --no-deps --wait/);
  }finally{assert.ok(path.resolve(run.root).startsWith(path.resolve(os.tmpdir())+path.sep+'salmon-update-script-'));fs.rmSync(run.root,{recursive:true,force:true});}
});
test('failed website startup restores the previous image and environment without discarding data',{skip:process.platform!=='win32'},()=>{
  const run=runUpdate(true);
  try{
    assert.notEqual(run.result.status,0);assert.equal(fs.readFileSync(path.join(run.root,'.env'),'utf8'),run.originalEnv);assert.equal(fs.readFileSync(path.join(run.root,'data/content.txt'),'utf8'),'Offline content 你好');
    assert.match(fs.readFileSync(run.log,'utf8'),/rollback.yml up -d --no-deps --wait/);
  }finally{assert.ok(path.resolve(run.root).startsWith(path.resolve(os.tmpdir())+path.sep+'salmon-update-script-'));fs.rmSync(run.root,{recursive:true,force:true});}
});

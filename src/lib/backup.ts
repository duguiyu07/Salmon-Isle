import fs from 'node:fs';
import path from 'node:path';
import { zipSync,unzipSync,strToU8,strFromU8 } from 'fflate';
import { dataDir,initDirs,within } from './paths';
import { db } from './db';
import { AppError } from './model';
import {repositoryConfig,activeRevision,runtimeDir} from './library-context';
export function backupData(){
  initDirs();const entries:Record<string,Uint8Array>={};
  const config=repositoryConfig(),revision=activeRevision();
  const visit=(dir:string)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isSymbolicLink())continue;const full=path.join(dir,e.name);const relative=path.relative(dataDir(),full).split(path.sep).join('/');if(config&&path.resolve(full)===path.resolve(config.workspace)||relative.startsWith('imports/')||relative.startsWith('.backup-')||relative.startsWith('state.sqlite')||relative==='setup-token'||['library-indexes','library-candidates','library-archives','disabled-git-hooks','library-setup','github-auth','backups'].includes(relative)||relative==='library-releases')continue;if(e.isDirectory())visit(full);else entries[relative]=fs.readFileSync(full);}};
  const capture=(root:string,prefix:string)=>{if(!fs.existsSync(root))return;const walk=(dir:string)=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw new AppError('备份内容库不允许符号链接');const file=path.join(dir,entry.name),relative=path.relative(root,file).split(path.sep).join('/');if(entry.isDirectory())walk(file);else entries[prefix+'/'+relative]=fs.readFileSync(file);}};walk(root);};
  if(config){capture(config.workspace,'content-repository');entries['library-connection.json']=strToU8(JSON.stringify({...config,workspace:'content-repository'},null,2));if(revision)capture(path.join(dataDir(),'library-releases',revision),'library-releases/'+revision);}
  visit(dataDir());if(config)entries['library-connection.json']=strToU8(JSON.stringify({...config,workspace:'content-repository'},null,2));const snapshot=path.join(dataDir(),`.backup-${Date.now()}.sqlite`);db().prepare('VACUUM INTO ?').run(snapshot);entries['state.sqlite']=fs.readFileSync(snapshot);fs.unlinkSync(snapshot);entries['backup-manifest.json']=strToU8(JSON.stringify({version:1,time:new Date().toISOString(),contentRepository:!!config}));return zipSync(entries);
}
export function restoreData(bytes:Uint8Array,target:string){
  const base=path.resolve(target);if(fs.existsSync(base)&&fs.readdirSync(base).length)throw new AppError('恢复目录必须为空。请先停止服务并保留原目录作为备份。');
  let total=0;const files=unzipSync(bytes,{filter:file=>{total+=file.originalSize;if(total>2*1024*1024*1024)throw new AppError('备份解压后过大');if(file.name.includes('\\')||file.name.split('/').includes('..')||file.name.startsWith('/')||/^[A-Za-z]:/.test(file.name))throw new AppError('非法备份路径');return !file.name.endsWith('/');}});
  const manifest=files['backup-manifest.json'];if(!manifest||JSON.parse(strFromU8(manifest)).version!==1)throw new AppError('不是有效的 Salmon Isle 备份');
  fs.mkdirSync(base,{recursive:true});for(const[name,data]of Object.entries(files)){if(name==='backup-manifest.json')continue;const file=within(base,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data,{mode:0o600});}
  if(JSON.parse(strFromU8(manifest)).contentRepository&&files['library-connection.json']){const config=JSON.parse(strFromU8(files['library-connection.json']));fs.writeFileSync(path.join(base,'library-connection.json'),JSON.stringify({...config,workspace:path.join(base,'content-repository')},null,2),{mode:0o600});}
}

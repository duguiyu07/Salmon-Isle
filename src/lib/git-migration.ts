import fs from 'node:fs';
import path from 'node:path';
import {withLibrary,runtimeDir} from './library-context';
import {listArticles,listFolders,listTrash,atomicWrite} from './storage';
import {listMedia,writeMediaMetadata} from './media';
import {libraryDirectories,validateLibrary} from './library-validation';
import {createEmptyLibrary,initializeRepository,git,validateConnection} from './content-repository';
import {backupData} from './backup';
import {AppError} from './model';
import {withRepositoryLock} from './repository-lock';

export async function copyLibrary(source:string,target:string){
  // Copy into absent directories: Node 24.22 rejects even an existing empty
  // directory with errorOnExist:true. Check every target before writing anything.
  for(const dir of libraryDirectories)if(fs.lstatSync(path.join(target,dir),{throwIfNoEntry:false}))throw new AppError('迁移目标包含已有内容目录，请使用空的内容工作区');
  fs.mkdirSync(target,{recursive:true});
  for(const dir of libraryDirectories){
    if(dir==='media-meta')continue;const from=path.join(source,dir);
    if(fs.existsSync(from))fs.cpSync(from,path.join(target,dir),{recursive:true,errorOnExist:true,force:false,dereference:false});
  }
  await createEmptyLibrary(target);
  const media=withLibrary(source,()=>listMedia());withLibrary(target,()=>{for(const row of media)writeMediaMetadata({...row,...(row.source?{source:row.source}:{source:undefined})});});
  return validateLibrary(target);
}
export async function migrateGit(target:string,apply=false){
  target=path.resolve(target);const source=runtimeDir();const connection={workspace:target,remote:process.env.SALMON_CONTENT_REMOTE||'',branch:process.env.SALMON_CONTENT_BRANCH||'main',siteUrl:process.env.SALMON_SITE_URL||''};validateConnection(connection);
  const relative=path.relative(source,target);if(!relative.startsWith('..')&&relative.split(path.sep)[0]==='content')throw new AppError('目标不能位于原始文章目录内');
  if(fs.existsSync(path.join(target,'library.json')))return {alreadyApplied:true,target,summary:validateLibrary(target)};
  const summary=withLibrary(source,()=>({articles:listArticles().length,folders:listFolders().length-1,media:listMedia().length,trash:listTrash().length}));
  if(!apply)return {alreadyApplied:false,target,summary,dryRun:true};
  return withRepositoryLock(async()=>{
    if(fs.existsSync(target)&&fs.readdirSync(target).length)throw new AppError('迁移目标必须为空；原始数据不会覆盖');
    const backup=path.resolve('backups','before-git-'+new Date().toISOString().replace(/[:.]/g,'-')+'.zip');fs.mkdirSync(path.dirname(backup),{recursive:true});
    fs.writeFileSync(backup,withLibrary(source,()=>backupData()),{mode:0o600});
    const verified=await copyLibrary(source,target);await initializeRepository(connection);await git(['add','--all'],{cwd:target});await git(['commit','-m','初始化内容库'],{cwd:target});
    return {alreadyApplied:false,target,summary:verified,backup,sha:(await git(['rev-parse','HEAD'],{cwd:target})).stdout.toString('utf8').trim()};
  },target);
}

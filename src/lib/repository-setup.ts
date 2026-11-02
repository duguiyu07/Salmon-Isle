import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runtimeDir,workspaceRoot,repositoryConfig,withRepositoryConfig,withLibrary,type RepositoryConfig} from './library-context';
import {git,initializeRepository,validateConnection,changes,materializeRevision,activateRemote,startRepositorySync} from './content-repository';
import {copyLibrary} from './git-migration';
import {libraryDirectories,libraryFiles,validateLibrary,managedPath} from './library-validation';
import {atomicWrite,listFolders,getSettings} from './storage';
import {backupData} from './backup';
import {withRepositoryLock} from './repository-lock';
import {within} from './paths';
import {digest} from './crypto';
import {githubRepositoryInfo,githubConnectionStatus} from './github-auth';
import {AppError} from './model';
import type {GitChange} from './git-model';

interface SetupJob {id:string;config:RepositoryConfig;source:string;phase:'preparing'|'review'|'applying'|'done'|'error';step:string;error?:string;summary?:ReturnType<typeof validateLibrary>;changes?:GitChange[];sourceSignature?:string;remoteHead?:string;sha?:string;backup?:string;updatedAt:string}
const jobs=()=>path.join(runtimeDir(),'library-setup');
const jobFile=(id:string)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw new AppError('迁移任务不存在',404);return path.join(jobs(),id,'job.json');};
const running=new Map<string,Promise<void>>();
function save(job:SetupJob){job.updatedAt=new Date().toISOString();atomicWrite(jobFile(job.id),JSON.stringify(job,null,2));}
function read(id:string):SetupJob{const file=jobFile(id);if(!fs.existsSync(file))throw new AppError('迁移任务不存在',404);return JSON.parse(fs.readFileSync(file,'utf8'));}
function publicJob(job:SetupJob){return {...job,source:undefined,sourceSignature:undefined};}
function fingerprint(root:string){
  const rows:string[]=[];
  const walk=(dir:string)=>{if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isSymbolicLink())throw new AppError('原始内容包含符号链接');const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else{const stat=fs.statSync(file,{bigint:true});rows.push(path.relative(root,file)+':'+stat.size+':'+stat.mtimeNs+':'+stat.ctimeNs);}}};
  for(const dir of libraryDirectories)walk(path.join(root,dir));
  return digest(rows.sort().join('\n'));
}
function execute(job:SetupJob,action:()=>Promise<void>){
  const key=jobFile(job.id);if(running.has(key))return;
  const task=action().catch(error=>{job.phase='error';job.error=error instanceof AppError?error.message:'迁移失败，原内容与备份已保留，请查看服务器日志';save(job);if(!(error instanceof AppError))console.error('Repository setup failed:',error);}).finally(()=>running.delete(key));
  running.set(key,task);
}
export async function prepareRepositorySetup(input:Partial<RepositoryConfig>&{remote:string;manual?:boolean}){
  const current=repositoryConfig(),workspace=input.workspace?.trim()||current?.workspace||path.join(runtimeDir(),'content-repository');
  if(current&&(path.resolve(current.workspace)!==path.resolve(workspace)||current.remote!==input.remote))throw new AppError('请先完成当前仓库的修改；连接向导暂不切换到另一内容库',409);
  const info=!input.manual&&/^https:\/\/github\.com\//.test(input.remote)?await githubRepositoryInfo(input.remote):null;
  const config:RepositoryConfig={workspace:path.resolve(workspace),remote:input.remote,branch:input.branch?.trim()||info?.branch||'main',siteUrl:input.siteUrl||''};validateConnection(config);
  if(!current&&fs.existsSync(config.workspace)&&fs.readdirSync(config.workspace).length)throw new AppError('请选择空的内容工作目录，已有文件不会被覆盖',409);
  const existing=path.join(jobs(),'current.json');
  if(fs.existsSync(existing)){const previous=read(JSON.parse(fs.readFileSync(existing,'utf8')).id);if(['preparing','applying'].includes(previous.phase))return getRepositorySetup(previous.id).job!;}
  const job:SetupJob={id:randomUUID(),config,source:workspaceRoot(),phase:'preparing',step:'读取远程仓库',updatedAt:new Date().toISOString()};save(job);atomicWrite(existing,JSON.stringify({id:job.id}));
  execute(job,()=>prepare(job));return publicJob(job);
}
async function prepare(job:SetupJob){
  const root=path.dirname(jobFile(job.id)),work=within(root,'work'),config={...job.config,workspace:work};
  if(fs.existsSync(work))fs.rmSync(work,{recursive:true,force:true});
  await withRepositoryConfig(config,()=>withLibrary(work,async()=>{
    await initializeRepository(config);
    const remote=(await git(['ls-remote','--heads','origin','refs/heads/'+config.branch])).stdout.toString().split(/\s/)[0];
    if(remote){
      await git(['fetch','--no-tags','origin','refs/heads/'+config.branch+':refs/remotes/origin/'+config.branch]);
      const files=(await git(['ls-tree','-rz','--name-only',remote])).stdout.toString().split('\0').filter(Boolean);
      if(files.some(file=>!managedPath(file)))throw new AppError('仓库包含其他项目文件，请使用专用内容仓库：'+files.filter(file=>!managedPath(file)).slice(0,5).join('、'));
      if(files.includes('library.json')){const checked=within(root,'remote-preview');if(fs.existsSync(checked))fs.rmSync(checked,{recursive:true,force:true});await materializeRevision(remote,checked);}
      else if(files.some(file=>!['README.md','.gitignore','.gitattributes'].includes(file)))throw new AppError('非空仓库不是 Salmon Isle 内容库，请选择空仓库');
      const attrs=(await git(['show',remote+':.gitattributes'],{allowFailure:true})).stdout.toString();
      if(attrs.split(/\r?\n/).some(line=>line.trim()&&!line.startsWith('#')&&!['* text=auto eol=lf','media/** -text'].includes(line.trim())))throw new AppError('仓库存在不支持的 Git 属性，请移除自定义过滤器或归档规则');
      await git(['switch','--no-track','-C',config.branch,'refs/remotes/origin/'+config.branch]);
    }
    job.remoteHead=remote||'';job.step='校验网站内容并生成差异';save(job);
    await withRepositoryLock(async()=>{
      for(const dir of libraryDirectories){const target=within(work,dir);if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});}
      job.summary=await copyLibrary(job.source,work);job.sourceSignature=fingerprint(job.source);
    },job.source);
    const folderIds=withLibrary(work,()=>new Set(listFolders().map(folder=>folder.id))),settings=getSettings();
    if(settings.homeFolders.some(id=>!folderIds.has(id))||settings.knowledgeRootId&&!folderIds.has(settings.knowledgeRootId))throw new AppError('网站设置引用的目录不在迁移内容中，请先检查网站设置');
    const ignored=(await git(['ls-files','--others','--ignored','--exclude-standard'])).stdout.toString().trim();if(ignored)throw new AppError('仓库的 .gitignore 忽略了内容文件，请先修正：'+ignored.slice(0,300));
    job.changes=await changes();job.phase='review';job.step='预检完成，等待确认';save(job);
  }));
}
export async function applyRepositorySetup(id:string){
  const job=read(id);if(job.phase==='done')return publicJob(job);
  if(job.phase!=='review'&&!(job.phase==='error'&&job.changes))throw new AppError('请先完成迁移预检',409);
  job.phase='applying';job.error=undefined;job.step='备份网站原始数据';save(job);execute(job,()=>apply(job));return publicJob(job);
}
async function apply(job:SetupJob){
  const work=within(path.dirname(jobFile(job.id)),'work'),config={...job.config,workspace:work};
  await withRepositoryLock(()=>withRepositoryLock(async()=>{
    const active=repositoryConfig();
    if(active?.workspace===job.config.workspace&&job.sha&&fs.existsSync(path.join(active.workspace,'.git','HEAD'))){
      const head=(await git(['rev-parse','HEAD'],{cwd:active.workspace})).stdout.toString().trim();
      if(head===job.sha){job.phase='done';job.step='网站已接入并同步';save(job);startRepositorySync();return;}
    }
    if(fingerprint(job.source)!==job.sourceSignature)throw new AppError('预检后网站内容发生了变化，请重新预检；新编辑已保留',409);
    if(!job.backup){job.backup=path.join(runtimeDir(),'backups','before-git-'+job.id+'.zip');fs.mkdirSync(path.dirname(job.backup),{recursive:true});fs.writeFileSync(job.backup,backupData(),{mode:0o600});save(job);}
    await withRepositoryConfig(config,()=>withLibrary(work,async()=>{
      job.step='创建迁移提交并推送';save(job);
      const remote=(await git(['ls-remote','--heads','origin','refs/heads/'+config.branch])).stdout.toString().split(/\s/)[0]||'';
      if(remote!==job.remoteHead&&remote!==job.sha)throw new AppError('远程仓库在预检后发生变化，请重新预检；不会覆盖远程提交',409);
      if(!job.sha){
        validateLibrary(work);if((await changes()).length){await git(['add','--all']);await git(['commit','-m','从网站迁移内容库']);}
        job.sha=(await git(['rev-parse','HEAD'])).stdout.toString().trim();save(job);
      }
      if(remote!==job.sha)await git(['push','origin','HEAD:refs/heads/'+config.branch]);
      await git(['fetch','--no-tags','origin','refs/heads/'+config.branch+':refs/remotes/origin/'+config.branch]);
      job.step='校验并切换上线快照';save(job);
      const staging=job.config.workspace+'.setup-'+job.id,previous=job.config.workspace+'.previous-'+job.id;
      if(path.dirname(path.resolve(staging))!==path.dirname(path.resolve(job.config.workspace)))throw new AppError('候选工作区路径无效');
      if(fs.existsSync(staging))fs.rmSync(staging,{recursive:true,force:true});
      fs.cpSync(work,staging,{recursive:true,dereference:false});
      validateLibrary(staging);
      const pointer=path.join(runtimeDir(),'library-active.json'),oldPointer=fs.existsSync(pointer)?fs.readFileSync(pointer):null;
      let moved=false;
      try{
        await activateRemote();
        if(fs.existsSync(job.config.workspace)){if(fs.existsSync(previous))throw new AppError('存在上次切换保留的工作区，请检查迁移任务',409);fs.renameSync(job.config.workspace,previous);moved=true;}
        fs.renameSync(staging,job.config.workspace);
        atomicWrite(path.join(runtimeDir(),'library-connection.json'),JSON.stringify(job.config,null,2)+'\n');
      }catch(error){
        if(moved&&!fs.existsSync(job.config.workspace))fs.renameSync(previous,job.config.workspace);
        if(oldPointer)atomicWrite(pointer,oldPointer);else if(fs.existsSync(pointer))fs.unlinkSync(pointer);
        throw error;
      }
      job.phase='done';job.step='网站已接入并同步';save(job);
    }));
  },job.config.workspace),job.source);
  startRepositorySync();
}
export function getRepositorySetup(id?:string){
  if(!id){const file=path.join(jobs(),'current.json');if(!fs.existsSync(file))return {job:null,github:githubConnectionStatus()};id=JSON.parse(fs.readFileSync(file,'utf8')).id;}
  const job=read(id!);
  if(['preparing','applying'].includes(job.phase)&&!running.has(jobFile(job.id)))execute(job,()=>job.phase==='preparing'?prepare(job):apply(job));
  return {job:publicJob(job),github:githubConnectionStatus()};
}

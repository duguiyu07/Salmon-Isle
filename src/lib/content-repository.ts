import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {unzipSync} from 'fflate';
import {AppError} from './model';
import {activeRevision,isDesktop,repositoryConfig,runtimeDir,withLibrary,withWorkspace,type RepositoryConfig} from './library-context';
import {atomicWrite,reindex,listArticles,listFolders,getSettings,articleMeta,splitMarkdown} from './storage';
import {readEditorDraft} from './editor-drafts';
import {libraryDirectories,managedPath,validateLibrary,validatePortablePath} from './library-validation';
import {withRepositoryLock} from './repository-lock';
import type {GitChange,GitCommit,GitConflict,GitDiff,GitStatus} from './git-model';
import {githubGitToken} from './github-auth';
import {recoverLibraryTransaction} from './library-transaction';

const shaPattern=/^[a-f0-9]{40,64}$/;
const interactiveGit=new AsyncLocalStorage<boolean>();
function config(){const c=repositoryConfig();if(!c)throw new AppError('请先连接内容仓库',409);return c;}
function journalFile(c=config()){return path.join(c.workspace,'.git','salmon-state.json');}
interface Journal {stash?:string;stashApplied?:boolean;error?:string;lastChecked?:string;lastSubmitted?:string;liveRevision?:string|null;acceptedRemote?:string}
function journal(c=config()):Journal{const file=journalFile(c);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};}
function saveJournal(patch:Partial<Journal>,c=config()){if(!fs.existsSync(path.join(c.workspace,'.git','HEAD')))return;atomicWrite(journalFile(c),JSON.stringify({...journal(c),...patch},null,2)+'\n');}
function safeRevision(value:string){if(!shaPattern.test(value))throw new AppError('无效提交 ID');return value;}
function safeFile(file:string){validatePortablePath(file);if(!managedPath(file))throw new AppError('不允许访问内容库之外的文件');return file;}
export function validateConnection(input:RepositoryConfig){
  if(!path.isAbsolute(input.workspace)||path.resolve(input.workspace)===path.parse(path.resolve(input.workspace)).root)throw new AppError('请选择独立内容库目录');
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(input.branch)||/\.\.|\/\/|\.lock(?:\/|$)/.test(input.branch)||/[/.]$/.test(input.branch))throw new AppError('分支名称无效');
  if(input.remote&&!/^(https:\/\/[^\s]+|ssh:\/\/[^\s]+|[\w.-]+@[\w.-]+:[^\s]+)$/.test(input.remote)&&!(process.env.SALMON_ALLOW_LOCAL_GIT==='true'&&path.isAbsolute(input.remote)))throw new AppError('仓库地址需要使用 HTTPS 或 SSH');
  if(input.remote.startsWith('https://')){const remote=new URL(input.remote);if(remote.username||remote.password)throw new AppError('请使用 Git 凭据管理器，不要把密码或令牌填入仓库地址');}
  if(input.siteUrl){const url=new URL(input.siteUrl);if(url.username||url.password||!['http:','https:'].includes(url.protocol))throw new AppError('网站地址无效');}
  const runtime=runtimeDir(),workspace=path.resolve(input.workspace);if(workspace===runtime||runtime.startsWith(workspace+path.sep)||workspace===path.join(runtime,'content')||workspace.startsWith(path.join(runtime,'content')+path.sep))throw new AppError('内容仓库不能覆盖原始数据目录');
}
export async function git(args:string[],options:{cwd?:string;input?:Buffer|string;allowFailure?:boolean;timeout?:number;interactive?:boolean}={}){
  const cwd=options.cwd||config().workspace;
  const hooks=path.join(runtimeDir(),'disabled-git-hooks');fs.mkdirSync(hooks,{recursive:true});
  const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_EDITOR:'true',GIT_SEQUENCE_EDITOR:'true',GCM_INTERACTIVE:options.interactive||interactiveGit.getStore()?'always':'never'} as NodeJS.ProcessEnv;
  const command=['-c','core.hooksPath='+hooks,'-c','core.autocrlf=false','-c','core.quotepath=false',...args];
  const c=repositoryConfig(),network=['fetch','push','ls-remote'].includes(args[0]),accessToken=network&&c?.remote?await githubGitToken(c.remote):null;
  if(accessToken){
    env.SALMON_GITHUB_TOKEN=accessToken;
    command.unshift('-c','credential.helper=','-c','credential.helper=!f() { if test "$1" = get; then printf "%s\\n" username=x-access-token "password=$SALMON_GITHUB_TOKEN"; fi; }; f');
  }else if(isDesktop()&&process.env.SALMON_GIT_CREDENTIAL_MANAGER){
    const manager="'"+process.env.SALMON_GIT_CREDENTIAL_MANAGER.replace(/\\/g,'/').replaceAll("'","'\\''")+"'";
    command.unshift('-c','credential.helper=','-c','credential.helper=!'+manager,'-c','credential.gitHubAuthModes=browser,device','-c','credential.credentialStore=wincredman','-c','credential.namespace=salmon-isle');
  }
  return new Promise<{code:number;stdout:Buffer;stderr:string}>((resolve,reject)=>{
    const child=spawn(process.env.SALMON_GIT_BINARY||'git',command,{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const output:Buffer[]=[],errors:Buffer[]=[];let size=0,tooLarge=false;
    const timer=setTimeout(()=>child.kill(),options.timeout||60000);
    child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>160*1024*1024){tooLarge=true;child.kill();}else output.push(chunk);});
    child.stderr.on('data',(chunk:Buffer)=>{if(errors.reduce((n,b)=>n+b.length,0)<65536)errors.push(chunk);});
    child.on('error',error=>{clearTimeout(timer);reject(new AppError('Git 无法启动：'+error.message));});
    child.on('close',code=>{clearTimeout(timer);let stderr=Buffer.concat(errors).toString('utf8').replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g,'$1***@');if(accessToken)stderr=stderr.replaceAll(accessToken,'***');if(tooLarge)return reject(new AppError('Git 输出过大'));if(code!==0&&!options.allowFailure)return reject(new AppError(stderr.trim()||'Git 操作超时或失败',409));resolve({code:code??-1,stdout:Buffer.concat(output),stderr});});
    child.stdin.on('error',()=>{});child.stdin.end(options.input);
  });
}
async function textGit(args:string[],allowFailure=false,cwd?:string){const r=await git(args,{allowFailure,cwd});return r.code===0?r.stdout.toString('utf8').trim():'';}
async function ref(name:string){return textGit(['rev-parse','--verify',name],true);}
async function existsHead(){return ref('HEAD');}
const remoteRef=(c=config())=>'refs/remotes/origin/'+c.branch;
function parseStatus(raw:Buffer):GitChange[]{const parts=raw.toString('utf8').split('\0'),result:GitChange[]=[];for(let i=0;i<parts.length;i++){const entry=parts[i];if(!entry)continue;const status=entry.slice(0,2),file=entry.slice(3);const oldPath=/[RC]/.test(status)?parts[++i]:undefined;result.push({path:file,status:status.trim()||'M',...(oldPath?{oldPath}:{})});}return result;}
export async function changes(){return parseStatus((await git(['status','--porcelain=v1','-z','--untracked-files=all'])).stdout);}
async function conflictPaths(){return (await textGit(['diff','--name-only','--diff-filter=U','-z'])).split('\0').filter(Boolean);}
function draftConflicts():GitConflict[]{
  try{return withWorkspace(()=>listArticles().flatMap(article=>{
    const draft=readEditorDraft(article.id);if(!draft||draft.baseVersion===article.version)return [];
    const current={...articleMeta(article),body:article.body,folderId:article.folderId};
    return [{path:'editor-drafts/'+article.id+'.json',binary:false,base:JSON.stringify(draft.baseDocument||{},null,2),local:JSON.stringify(draft,null,2),remote:JSON.stringify({...draft,baseVersion:article.version,document:current,baseDocument:current},null,2),hasLocal:true,hasRemote:true}];
  }));}catch{return [];}
}
function rebasing(){const dir=path.join(config().workspace,'.git');return fs.existsSync(path.join(dir,'rebase-merge'))||fs.existsSync(path.join(dir,'rebase-apply'));}
async function counts(){const head=await existsHead(),remote=await ref(remoteRef());if(!head)return {head:null,remoteHead:remote||null,ahead:0,behind:remote?1:0};if(!remote)return {head,remoteHead:null,ahead:Number(await textGit(['rev-list','--count','HEAD'])),behind:0};const [behind,ahead]=(await textGit(['rev-list','--left-right','--count',remoteRef()+'...HEAD'])).split(/\s+/).map(Number);return {head,remoteHead:remote,ahead,behind};}
export async function repositoryStatus():Promise<GitStatus>{
  const c=repositoryConfig();if(!c)return {configured:false,ahead:0,behind:0,changes:[],conflicts:[],phase:'unconfigured'};
  if(!fs.existsSync(path.join(c.workspace,'.git')))return {configured:true,...c,head:null,ahead:0,behind:0,changes:[],conflicts:[],phase:'error',error:'内容仓库尚未初始化；请运行迁移或重新连接'};
  const state=journal(),current=await counts(),pending=await changes(),conflicts=[...new Set([...await conflictPaths(),...draftConflicts().map(conflict=>conflict.path)])];const liveRevision=isDesktop()?state.liveRevision:activeRevision();
  const liveContainsHead=!!(current.head&&liveRevision&&(current.head===liveRevision||(await git(['merge-base','--is-ancestor',current.head,liveRevision],{allowFailure:true})).code===0));
  let phase:GitStatus['phase']=pending.length?'pending':'saved';
  if(current.ahead)phase='push-pending';else if(pending.length)phase='pending';else if(liveContainsHead)phase='synced';else if(state.lastSubmitted&&(!liveRevision||state.lastSubmitted!==liveRevision))phase='sync-pending';
  if(state.error)phase='error';if(conflicts.length||rebasing())phase='conflict';
  return {configured:true,...c,...current,changes:pending,conflicts,liveRevision,error:state.error,lastChecked:state.lastChecked,phase};
}
export async function initializeRepository(c:RepositoryConfig){
  recoverLibraryTransaction(c.workspace);
  validateConnection(c);fs.mkdirSync(c.workspace,{recursive:true});
  if(fs.existsSync(path.join(c.workspace,'.git'))&&!fs.statSync(path.join(c.workspace,'.git')).isDirectory())throw new AppError('请选择普通内容仓库克隆目录，不支持外部 Git worktree');
  if(!fs.existsSync(path.join(c.workspace,'.git','HEAD'))){
    // Only a dedicated library (or empty folder) may become a repository.
    const files=fs.readdirSync(c.workspace).filter(name=>!libraryDirectories.includes(name as any));
    if(files.length&&!files.includes('library.json'))throw new AppError('请选择空目录或已经迁移的内容仓库');
    await git(['init','--initial-branch='+c.branch],{cwd:c.workspace});
  }
  if(!(await textGit(['config','user.name'],true,c.workspace)))await git(['config','user.name','Salmon Isle'],{cwd:c.workspace});
  if(!(await textGit(['config','user.email'],true,c.workspace)))await git(['config','user.email','content@salmon-isle.local'],{cwd:c.workspace});
  await git(['config','core.longpaths','true'],{cwd:c.workspace});
  const currentRemote=await textGit(['remote','get-url','origin'],true,c.workspace);
  if(c.remote&&currentRemote!==c.remote)await git(['remote',currentRemote?'set-url':'add','origin',c.remote],{cwd:c.workspace});
  const currentBranch=await textGit(['symbolic-ref','--short','HEAD'],true,c.workspace);if(currentBranch&&currentBranch!==c.branch)throw new AppError('现有仓库分支与连接配置不一致');
}
export async function connectRepository(input:RepositoryConfig){
  if(!isDesktop())throw new AppError('服务器内容仓库请通过部署环境变量配置',403);
  if(repositoryConfig()&&path.resolve(config().workspace)!==path.resolve(input.workspace))throw new AppError('当前已连接仓库；更换目录前请先完成待提交修改',409);
  validateConnection({...input,branch:input.branch||'main'});
  if(!input.branch){
    const refs=(await git(['ls-remote','--symref',input.remote,'HEAD'],{cwd:runtimeDir(),interactive:true})).stdout.toString('utf8');
    input={...input,branch:/^ref: refs\/heads\/([^\s]+)\s+HEAD/m.exec(refs)?.[1]||'main'};
  }
  return interactiveGit.run(true,()=>withRepositoryLock(async()=>{
    await initializeRepository(input);
    atomicWrite(path.join(runtimeDir(),'library-connection.json'),JSON.stringify(input,null,2)+'\n');
    await fetchRemote();
    const head=await existsHead(),remote=await ref(remoteRef());
    if(!head&&remote){if((await changes()).length)throw new AppError('本地目录存在文件，不能覆盖；请使用空目录');await inspectTree(remote);await git(['switch','--no-track','-C',input.branch,remoteRef()]);}
    if(!fs.existsSync(path.join(input.workspace,'library.json'))){if(head||remote)throw new AppError('这不是 Salmon Isle 内容仓库');await createEmptyLibrary(input.workspace);}
    validateLibrary(input.workspace);withWorkspace(()=>reindex());await checkWebsite();return repositoryStatus();
  },input.workspace));
}
export async function createEmptyLibrary(root:string){for(const dir of libraryDirectories)fs.mkdirSync(path.join(root,dir),{recursive:true});atomicWrite(path.join(root,'library.json'),JSON.stringify({version:1},null,2)+'\n');atomicWrite(path.join(root,'.gitattributes'),'* text=auto eol=lf\nmedia/** -text\n');}
async function fetchRemote(){const c=config();if(!c.remote)return;
  const accepted=journal().acceptedRemote||await ref(remoteRef());
  const present=await textGit(['ls-remote','--heads','origin','refs/heads/'+c.branch]);
  if(!present){if(await ref(remoteRef()))throw new AppError('远程同步分支已被删除，已停止同步',409);return;}
  await git(['fetch','--no-tags','origin','+refs/heads/'+c.branch+':'+remoteRef()]);const fetched=await ref(remoteRef());
  if(accepted&&(await git(['merge-base','--is-ancestor',accepted,fetched],{allowFailure:true})).code!==0)throw new AppError('远程历史发生重写，已停止合并与发布',409);
  saveJournal({acceptedRemote:fetched,lastChecked:new Date().toISOString(),error:undefined});
}
async function inspectTree(revision:string){
  const entries=(await git(['ls-tree','-rz','--full-tree',safeRevision(revision)])).stdout.toString('utf8').split('\0').filter(Boolean),seen=new Set<string>();
  for(const entry of entries){const [meta,file]=entry.split('\t');if(!meta.startsWith('100644 blob ')&&!meta.startsWith('100755 blob '))throw new AppError('仓库不允许符号链接或子模块');safeFile(file);const key=file.normalize('NFC').toLowerCase();if(seen.has(key))throw new AppError('仓库有大小写重复路径');seen.add(key);}
  const attrs=await git(['show',revision+':.gitattributes'],{allowFailure:true});if(attrs.stdout.toString('utf8').split(/\r?\n/).some(line=>line.trim()&&!line.trim().startsWith('#')&&!['* text=auto eol=lf','media/** -text'].includes(line.trim())))throw new AppError('内容仓库只允许标准文本和媒体 Git 属性，不允许自定义过滤器或归档规则');
}
export async function materializeRevision(revision:string,target:string){
  await inspectTree(revision);
  const archiveDir=path.join(runtimeDir(),'library-archives'),archiveFile=path.join(archiveDir,randomUUID()+'.zip');
  fs.mkdirSync(archiveDir,{recursive:true,mode:0o700});fs.writeFileSync(archiveFile,'',{mode:0o600});
  let zip:Buffer;
  try{await git(['archive','--format=zip','--output='+archiveFile,revision],{timeout:180000});if(fs.statSync(archiveFile).size>2*1024*1024*1024)throw new AppError('仓库归档过大');zip=fs.readFileSync(archiveFile);}finally{fs.unlinkSync(archiveFile);}
  let total=0;
  const files=unzipSync(zip,{filter:entry=>{total+=entry.originalSize;if(entry.originalSize>41*1024*1024||total>2*1024*1024*1024)throw new AppError('仓库归档过大');return !entry.name.endsWith('/');}});
  fs.mkdirSync(target,{recursive:true});for(const [file,bytes]of Object.entries(files)){safeFile(file);const destination=path.join(target,...file.split('/'));fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes,{mode:0o600});}
  for(const dir of libraryDirectories)fs.mkdirSync(path.join(target,dir),{recursive:true});
  return validateLibrary(target);
}
async function verifyRevision(revision:string){const dir=path.join(runtimeDir(),'library-candidates',randomUUID());try{return await materializeRevision(revision,dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
export async function activateRemote(){
  if(isDesktop())return;const revision=await ref(remoteRef());if(!revision||revision===activeRevision())return;
  const previous=activeRevision();if(previous&&(await git(['merge-base','--is-ancestor',previous,revision],{allowFailure:true})).code!==0)throw new AppError('远程历史发生重写，网站保留上一版本',409);
  const releases=path.join(runtimeDir(),'library-releases'),candidate=path.join(releases,'.candidate-'+randomUUID()),target=path.join(releases,revision);
  fs.mkdirSync(releases,{recursive:true});
  try{
    await materializeRevision(revision,candidate);
    const settings=getSettings(),folderIds=withLibrary(candidate,()=>new Set(listFolders().map(folder=>folder.id)));
    if(settings.knowledgeRootId&&!folderIds.has(settings.knowledgeRootId)||settings.homeFolders.some(id=>!folderIds.has(id)))throw new AppError('网站设置仍引用已删除的文件夹，请先在在线设置中调整目录');
    if(!fs.existsSync(target))fs.renameSync(candidate,target);else {validateLibrary(target);fs.rmSync(candidate,{recursive:true,force:true});}
    withLibrary(target,()=>reindex());atomicWrite(path.join(runtimeDir(),'library-active.json'),JSON.stringify({revision,activatedAt:new Date().toISOString()})+'\n');
  }
  catch(error){fs.rmSync(candidate,{recursive:true,force:true});throw error;}
}
async function dropOwnedStash(oid:string){const rows=(await textGit(['stash','list','--format=%gd%x09%H'])).split('\n');const row=rows.find(row=>row.endsWith('\t'+oid));if(row)await git(['stash','drop',row.split('\t')[0]]);}
async function restoreStash(){const state=journal();if(!state.stash)return;
  if(!state.stashApplied){const applied=await git(['stash','apply',state.stash],{allowFailure:true});if(applied.code!==0){saveJournal({stashApplied:(await conflictPaths()).length>0,error:'远程更新与本地改动冲突，恢复副本已保留'});throw new AppError('远程更新与本地改动冲突，请先解决冲突',409);}saveJournal({stashApplied:true});}
  if((await conflictPaths()).length)throw new AppError('请先解决全部冲突',409);
  await dropOwnedStash(state.stash);saveJournal({stash:undefined,stashApplied:undefined});
}
async function integrateRemote(){
  if((await conflictPaths()).length)throw new AppError('请先解决内容冲突',409);
  if(rebasing()){await git(['rebase','--continue']);await restoreStash();}
  else if(journal().stash)await restoreStash();
  const head=await existsHead(),remote=await ref(remoteRef());if(!remote||head===remote)return;
  if(!head){if((await changes()).length)throw new AppError('远程已有初始内容，本地也有未提交内容；请先备份并使用空目录连接');await inspectTree(remote);await git(['switch','--no-track','-C',config().branch,remoteRef()]);return;}
  if((await git(['merge-base',head,remote],{allowFailure:true})).code!==0)throw new AppError('本地和远程不是同一内容库，不能自动合并');
  if((await git(['merge-base','--is-ancestor',remote,head],{allowFailure:true})).code===0)return;
  await inspectTree(remote);
  const dirty=await changes();dirty.forEach(change=>{safeFile(change.path);if(change.oldPath)safeFile(change.oldPath);});
  if(dirty.length){await git(['stash','push','--include-untracked','-m','salmon-recovery-'+randomUUID()]);const stash=await ref('refs/stash');saveJournal({stash,stashApplied:false});}
  const result=await git(['rebase',remoteRef()],{allowFailure:true});if(result.code!==0){saveJournal({error:'提交重放发生冲突，恢复副本已保留'});throw new AppError('提交重放发生冲突，请在待提交页面处理',409);}
  await restoreStash();withWorkspace(()=>reindex());
}
async function checkWebsite(){const c=config();if(!isDesktop()||!c.siteUrl)return;
  let revision:string|null=null;
  try{const response=await fetch(new URL('/api/health',c.siteUrl),{signal:AbortSignal.timeout(8000),cache:'no-store'});if(!response.ok)throw new Error('网站暂不可用');const data=await response.json();revision=typeof data.contentRevision==='string'&&shaPattern.test(data.contentRevision)?data.contentRevision:null;}catch{saveJournal({liveRevision:null});return;}
  if(revision&&(await git(['cat-file','-e',revision+'^{commit}'],{allowFailure:true})).code!==0)throw new AppError('网站上线版本不属于当前内容仓库，请检查两端的仓库与分支配置',409);
  saveJournal({liveRevision:revision});
}
export async function synchronizeRepository(merge=false){return interactiveGit.run(merge,()=>withRepositoryLock(async()=>{
  try{await initializeRepository(config());await fetchRemote();await activateRemote();if(merge||!await existsHead())await integrateRemote();await checkWebsite();saveJournal({error:undefined});return repositoryStatus();}
  catch(error){saveJournal({error:error instanceof Error?error.message:'同步失败'});throw error;}
}));}
export async function commitAndPush(message='',operationId=''){return interactiveGit.run(true,()=>withRepositoryLock(async()=>{
  try{
    const c=config();if(!c.remote)throw new AppError('请先配置远程仓库地址');
    if(operationId&&!/^[\w-]{1,100}$/.test(operationId))throw new AppError('无效操作 ID');
    const receipt=operationId?path.join(c.workspace,'.git','salmon-receipts',operationId+'.json'):null;
    if(receipt&&fs.existsSync(receipt)){const previous=JSON.parse(fs.readFileSync(receipt,'utf8'));if((await git(['merge-base','--is-ancestor',previous.sha,remoteRef()],{allowFailure:true})).code===0)return {...previous,status:await repositoryStatus()};}
    await fetchRemote();await integrateRemote();if(draftConflicts().length)throw new AppError('正式内容已更新，请先合并对应编辑稿',409);let head=await existsHead();
    // A failed push is retried before creating another commit. New edits stay
    // in the worktree and are included only by the next explicit submission.
    if(!(await counts()).ahead){
      withWorkspace(()=>validateLibrary(c.workspace));const ignored=await textGit(['ls-files','--others','--ignored','--exclude-standard']);if(ignored)throw new AppError('内容库有被 Git 忽略的文件，请先修正 .gitignore');const pending=await changes();if(!pending.length)throw new AppError('没有需要提交的修改');
      const paths=[...new Set(pending.flatMap(change=>[change.path,...(change.oldPath?[change.oldPath]:[])]))];paths.forEach(safeFile);
      await git(['add','-A','--pathspec-from-file=-','--pathspec-file-nul'],{input:Buffer.from(paths.join('\0')+'\0')});
      await git(['commit','-m',message.trim().slice(0,2000)||'更新内容库 '+new Date().toISOString()]);head=await existsHead();
    }
    if(!head)throw new AppError('没有可推送的提交');await verifyRevision(head);
    await git(['push','origin','HEAD:refs/heads/'+c.branch]);saveJournal({lastSubmitted:head,error:undefined});
    const result={sha:head};if(receipt)atomicWrite(receipt,JSON.stringify(result));
    await fetchRemote();await activateRemote();await checkWebsite();return {...result,status:await repositoryStatus()};
  }catch(error){saveJournal({error:error instanceof Error?error.message:'提交或推送失败'});throw error;}
}));}
export async function commitHistory():Promise<GitCommit[]>{if(!await existsHead())return [];const log=await textGit(['log','--max-count=100','--format=%H%x1f%an%x1f%aI%x1f%s%x1e']);return log.split('\x1e').filter(row=>row.trim()).map(row=>{const [sha,author,time,...message]=row.trim().split('\x1f');return {sha,author,time,message:message.join(' ')};});}
export async function revisionChanges(revision:string):Promise<GitChange[]>{safeRevision(revision);const raw=(await git(['diff-tree','--root','--no-commit-id','--name-status','-r','-z','--find-renames',revision])).stdout.toString('utf8').split('\0'),result:GitChange[]=[];for(let i=0;i<raw.length;i++){const status=raw[i];if(!status)continue;const first=raw[++i];if(/^[RC]/.test(status))result.push({status,path:raw[++i],oldPath:first});else result.push({status,path:first});}return result;}
export async function revisionBlob(revision:string,file:string){safeRevision(revision);safeFile(file);const result=await git(['show',revision+':'+file],{allowFailure:true});if(result.code!==0)throw new AppError('该版本中不存在此文件',404);return result.stdout;}
function binary(bytes:Buffer){return bytes.includes(0)||bytes.length>2*1024*1024;}
export async function fileDiff(file:string,revision?:string,oldPath?:string):Promise<GitDiff>{
  safeFile(file);if(oldPath)safeFile(oldPath);let beforeRevision:string|null=null,afterRevision:string|null=null,beforeExists=false,afterExists=false;let before:Buffer=Buffer.alloc(0),after:Buffer=Buffer.alloc(0);
  if(revision){afterRevision=safeRevision(revision);beforeRevision=await ref(revision+'^')||null;const result=await git(['show',revision+':'+file],{allowFailure:true});after=result.stdout;afterExists=result.code===0;}
  else {beforeRevision=await existsHead()||null;const absolute=path.join(config().workspace,...file.split('/'));if(fs.existsSync(absolute)){after=fs.readFileSync(absolute);afterExists=true;}}
  if(beforeRevision){const result=await git(['show',beforeRevision+':'+(oldPath||file)],{allowFailure:true});before=result.stdout;beforeExists=result.code===0;}
  const isBinary=file.startsWith('media/')||binary(before)||binary(after);let patch='';if(!isBinary&&beforeRevision){const args=['diff','--no-ext-diff','--no-textconv',beforeRevision,...(afterRevision?[afterRevision]:[]),'--',...(oldPath?[oldPath]:[]),file];patch=await textGit(args);}
  return {path:file,beforePath:oldPath||file,before:isBinary?'':before.toString('utf8'),after:isBinary?'':after.toString('utf8'),patch,binary:isBinary,beforeExists,afterExists,beforeRevision,afterRevision};
}
export async function conflicts():Promise<GitConflict[]>{const paths=await conflictPaths();const result:GitConflict[]=[];for(const file of paths){safeFile(file);const stages=await Promise.all([1,2,3].map(stage=>git(['show',':'+stage+':'+file],{allowFailure:true})));const isBinary=file.startsWith('media/')||stages.some(stage=>binary(stage.stdout));result.push({path:file,binary:isBinary,base:isBinary?'':stages[0].stdout.toString('utf8'),local:isBinary?'':stages[2].stdout.toString('utf8'),remote:isBinary?'':stages[1].stdout.toString('utf8'),hasLocal:stages[2].code===0,hasRemote:stages[1].code===0});}return [...result,...draftConflicts().filter(conflict=>!paths.includes(conflict.path))];}
export async function resolveConflict(file:string,choice:'local'|'remote'|'manual',content?:string){return withRepositoryLock(async()=>{
  safeFile(file);const semantic=draftConflicts().find(conflict=>conflict.path===file);
  if(semantic&&!(await conflictPaths()).includes(file)){
    const selected=choice==='manual'?content:choice==='local'?semantic.local:semantic.remote;if(!selected)throw new AppError('合并结果为空');
    const draft=JSON.parse(selected),article=withWorkspace(()=>listArticles().find(article=>article.id===draft.articleId));if(!article)throw new AppError('编辑稿对应文章不存在');
    draft.baseVersion=article.version;draft.draftVersion=randomUUID();draft.baseDocument={...articleMeta(article),body:article.body,folderId:article.folderId};
    atomicWrite(path.join(config().workspace,...file.split('/')),JSON.stringify(draft,null,2)+'\n');saveJournal({error:undefined});return repositoryStatus();
  }
  if(!(await conflictPaths()).includes(file))throw new AppError('该文件没有待解决的冲突');
  const absolute=path.join(config().workspace,...file.split('/'));
  if(choice==='manual'){if(file.startsWith('media/')||typeof content!=='string'||Buffer.byteLength(content)>12*1024*1024)throw new AppError('手动合并内容无效');if(file.endsWith('.json'))JSON.parse(content);else if(file.endsWith('.md'))splitMarkdown(content);atomicWrite(absolute,content);}
  else {const selected=await git(['show',':'+(choice==='local'?3:2)+':'+file],{allowFailure:true});if(selected.code===0)atomicWrite(absolute,selected.stdout);else if(fs.existsSync(absolute))fs.unlinkSync(absolute);}
  await git(['add','-A','--',file]);
  if(!(await conflictPaths()).length){if(rebasing())await git(['rebase','--continue']);await restoreStash();saveJournal({error:undefined});withWorkspace(()=>reindex());}
  return repositoryStatus();
});}

export function startRepositorySync(){
  if(process.env.NODE_ENV==='test')return;
  if(!repositoryConfig())return;
  const registry=globalThis as typeof globalThis&{salmonSyncTimer?:ReturnType<typeof setInterval>};if(registry.salmonSyncTimer)return;
  let running=false;
  const tick=()=>{if(running)return;running=true;void synchronizeRepository(false).catch(error=>console.error('Content sync:',error instanceof Error?error.message:'failed')).finally(()=>{running=false;});};
  tick();registry.salmonSyncTimer=setInterval(tick,Math.max(5000,Number(process.env.SALMON_SYNC_INTERVAL_MS)||30000));registry.salmonSyncTimer.unref();
}

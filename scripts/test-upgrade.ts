import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import appPackage from '../package.json';
import {saveArticle,atomicWrite} from '../src/lib/storage';
import {saveEditorDraft} from '../src/lib/editor-drafts';
import {closeDatabases} from '../src/lib/db';

// Installers register an application in Windows. Run only on a disposable CI host.
if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true')throw new Error('覆盖安装测试仅在隔离的 GitHub Actions Windows 主机运行');
const repository=process.env.GITHUB_REPOSITORY||'duguiyu07/Salmon-Isle',headers={Accept:'application/vnd.github+json','User-Agent':'Salmon-Isle-Upgrade-Test',...(process.env.GH_TOKEN?{Authorization:'Bearer '+process.env.GH_TOKEN}:{})};
const response=await fetch('https://api.github.com/repos/'+repository+'/releases?per_page=100',{headers});if(!response.ok)throw new Error('无法查询旧版安装包');
const releases=await response.json();const previous=releases.filter((release:any)=>/^v1\.\d+\.\d+$/.test(release.tag_name)&&!release.draft&&release.assets.some((asset:any)=>/^Salmon-Isle-Writer-.*-x64\.exe$/.test(asset.name))).sort((a:any,b:any)=>b.tag_name.localeCompare(a.tag_name,undefined,{numeric:true}))[0];
if(!previous)throw new Error('缺少用于覆盖升级测试的 1.x 安装包');
fs.mkdirSync(path.resolve('.qa-artifacts'),{recursive:true});
const installer=previous.assets.find((asset:any)=>/^Salmon-Isle-Writer-.*-x64\.exe$/.test(asset.name)),checksums=previous.assets.find((asset:any)=>asset.name==='SHA256SUMS.txt');if(!checksums)throw new Error('旧安装包缺少校验文件');
const root=fs.mkdtempSync(path.resolve('.qa-artifacts','upgrade-')),install=path.join(root,'application'),data=path.join(root,'profile'),oldInstaller=path.join(root,'previous.exe');
const bytes=Buffer.from(await(await fetch(installer.browser_download_url)).arrayBuffer()),sum=createHash('sha256').update(bytes).digest('hex'),list=await(await fetch(checksums.browser_download_url)).text();if(!list.split(/\r?\n/).some(line=>line.trim()===sum+'  '+installer.name))throw new Error('旧安装包 SHA-256 不匹配');fs.writeFileSync(oldInstaller,bytes);
function run(file:string,args:string[],env=process.env){const result=spawnSync(file,args,{env,windowsHide:true,encoding:'utf8',timeout:180000});if(result.status!==0){const log=path.join(data,'desktop.log');throw new Error('Upgrade test failed: '+path.basename(file)+'\n'+result.stdout+'\n'+result.stderr+'\n'+result.error+(fs.existsSync(log)?'\n'+fs.readFileSync(log,'utf8').split(/\r?\n/).slice(-45).join('\n'):''));}return result.stdout;}
run(oldInstaller,['/S','/D='+install]);
process.env.SALMON_DATA_DIR=data;process.env.SALMON_DESKTOP='true';const library=path.join(root,'legacy-content');fs.mkdirSync(library,{recursive:true});atomicWrite(path.join(library,'library.json'),JSON.stringify({version:1}));atomicWrite(path.join(data,'library-connection.json'),JSON.stringify({workspace:library,remote:'https://example.test/legacy-content.git',branch:'main',siteUrl:''}));
const article=saveArticle({id:'upgrade-fixture',title:'升级前的文章',body:'PRESERVED_1X_PUBLISHED_CONTENT',status:'published'},{create:true});saveEditorDraft(article.id,{title:article.title,body:'PRESERVED_1X_UNPUBLISHED_DRAFT',folderId:'root'},{baseVersion:article.version,draftVersion:null});closeDatabases();
const next=path.resolve('dist/desktop',`Salmon-Isle-Writer-${appPackage.version}-x64.exe`);run(next,['/S','/D='+install]);
const executable=path.join(install,'Salmon Isle Writer.exe');if(!fs.existsSync(executable))throw new Error('覆盖安装后缺少桌面程序');
const inherited={...process.env};for(const key of Object.keys(inherited))if(key.toUpperCase()==='PATH'||key==='NODE_PATH'||key.startsWith('SALMON_'))delete inherited[key];
const output=run(executable,['--smoke'],{...inherited,PATH:path.join(process.env.SystemRoot||'C:\\Windows','System32'),SALMON_DESKTOP_DATA_DIR:data});if(!output.includes('"desktopSmoke":"passed"'))throw new Error('升级后桌面验证未完成');
const content=path.join(data,'library-v2','content');if(!fs.readdirSync(content).some(file=>fs.readFileSync(path.join(content,file),'utf8').includes('PRESERVED_1X_PUBLISHED_CONTENT')))throw new Error('旧文章未保留');
const draft=JSON.parse(fs.readFileSync(path.join(data,'library-v2','editor-drafts','upgrade-fixture.json'),'utf8'));if(draft.document.body!=='PRESERVED_1X_UNPUBLISHED_DRAFT')throw new Error('旧草稿未保留');
console.log(JSON.stringify({upgrade:'passed',from:previous.tag_name,to:appPackage.version,overwriteInstall:true,oldContentPreserved:true,oldDraftPreserved:true,noSystemGit:true}));

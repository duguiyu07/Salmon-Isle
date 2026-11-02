import fs from 'node:fs';
import path from 'node:path';
import {createSign,createHmac,timingSafeEqual,randomBytes} from 'node:crypto';
import {runtimeDir,isDesktop,repositoryConfig} from './library-context';
import {atomicWrite} from './storage';
import {AppError} from './model';
import {digest} from './crypto';

interface AppCredentials {appId:number;clientId:string;clientSecret:string;privateKey:string;webhookSecret:string;slug:string;origin:string;owner:string;repo:string;installationId?:number;repositoryId?:number}
interface AuthFlow {state:string;session:string;expires:number;remote:string;origin:string;stage:'manifest'|'install'|'oauth'|'done';app?:AppCredentials}
const credentialFile=()=>path.join(runtimeDir(),'github-connection.json');
const flowFile=(state:string)=>{if(!/^[a-f0-9]{64}$/.test(state))throw new AppError('授权状态无效',403);return path.join(runtimeDir(),'github-auth',state+'.json');};
export function githubRepository(remote:string){
  const match=/^https:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote);
  if(!match||match[2]==='.'||match[2]==='..')throw new AppError('请输入 GitHub HTTPS 仓库地址，例如 https://github.com/you/content.git');
  return {owner:match[1],repo:match[2],remote:'https://github.com/'+match[1]+'/'+match[2]+'.git'};
}
function credentials():AppCredentials|null{const file=credentialFile();return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;}
function saveFlow(flow:AuthFlow){atomicWrite(flowFile(flow.state),JSON.stringify(flow));}
function readFlow(state:string,session:string,stage:AuthFlow['stage']){
  const file=flowFile(state);if(!fs.existsSync(file))throw new AppError('授权已过期，请重新连接',403);
  const flow=JSON.parse(fs.readFileSync(file,'utf8')) as AuthFlow;
  if(flow.expires<Date.now()||flow.session!==digest(session)||flow.stage!==stage)throw new AppError('授权状态已过期或已使用，请重新连接',403);
  return flow;
}
function apiBase(){return process.env.NODE_ENV==='test'&&process.env.SALMON_GITHUB_API_TEST_URL||'https://api.github.com';}
function oauthBase(){return process.env.NODE_ENV==='test'&&process.env.SALMON_GITHUB_OAUTH_TEST_URL||'https://github.com';}
export async function githubRequest(endpoint:string,token?:string,body?:unknown){
  let response:Response;
  try{response=await fetch(apiBase()+endpoint,{method:body===undefined?'GET':'POST',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10',...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000),cache:'no-store'});}
  catch{throw new AppError('无法连接 GitHub，请检查网络后重试',502);}
  if(!response.ok)throw new AppError(response.status===401?'GitHub 授权已失效，请重新授权':response.status===403?'GitHub 权限不足或请求受限，请检查授权后重试':response.status===404?'GitHub 仓库或安装不存在，请确认已授权目标仓库':'GitHub 暂时无法完成操作，请稍后重试',response.status===401?401:409);
  return response.json();
}
export function appJwt(app:Pick<AppCredentials,'appId'|'privateKey'>){
  const header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url'),now=Math.floor(Date.now()/1000);
  const payload=Buffer.from(JSON.stringify({iat:now-60,exp:now+540,iss:String(app.appId)})).toString('base64url'),input=header+'.'+payload;
  return input+'.'+createSign('RSA-SHA256').update(input).sign(app.privateKey,'base64url');
}
const tokens=new Map<string,{token:string;expires:number}>();
async function installationToken(app:AppCredentials){
  const key=digest(runtimeDir()+':'+app.privateKey+':'+app.installationId+':'+app.repositoryId),cached=tokens.get(key);
  if(cached&&cached.expires>Date.now()+120000)return cached.token;
  const result=await githubRequest('/app/installations/'+app.installationId+'/access_tokens',appJwt(app),{repository_ids:[app.repositoryId],permissions:{contents:'write',metadata:'read'}});
  if(typeof result.token!=='string'||!Number.isFinite(Date.parse(result.expires_at)))throw new AppError('GitHub 返回了无效的安装令牌',502);
  tokens.set(key,{token:result.token,expires:Date.parse(result.expires_at)});return result.token as string;
}
export function githubConnectionStatus(){
  const app=credentials();return {authorized:!!(app?.installationId&&app?.repositoryId),repository:app?app.owner+'/'+app.repo:null};
}
export async function githubGitToken(remote:string){
  if(isDesktop()||!/^https:\/\/github\.com\//i.test(remote))return null;
  const app=credentials();if(!app?.installationId||!app.repositoryId)return null;
  const target=githubRepository(remote);if((target.owner+'/'+target.repo).toLowerCase()!==(app.owner+'/'+app.repo).toLowerCase())return null;
  return installationToken(app);
}
export function beginGithubAuthorization(remote:string,origin:string,session:string,recreate=false){
  if(isDesktop())throw new AppError('请在网站后台连接 GitHub',403);
  const parsed=githubRepository(remote),url=new URL(origin);
  const current=repositoryConfig();
  if(current&&![parsed.remote,'git@github.com:'+parsed.owner+'/'+parsed.repo+'.git'].includes(current.remote))throw new AppError('当前网站已连接其他内容仓库，请先处理当前连接',409);
  if(url.origin!==origin||url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new AppError('GitHub 授权需要网站的 HTTPS 地址');
  const state=randomBytes(32).toString('hex'),flow:AuthFlow={state,session:digest(session),expires:Date.now()+3600000,remote:parsed.remote,origin,stage:'manifest'};
  const existing=credentials();
  if(!recreate&&existing?.origin===origin&&existing.owner.toLowerCase()===parsed.owner.toLowerCase()){
    flow.stage='install';flow.app={...existing,owner:parsed.owner,repo:parsed.repo,installationId:undefined,repositoryId:undefined};saveFlow(flow);
    return {state,redirect:'https://github.com/apps/'+existing.slug+'/installations/new?state='+state,action:'',manifest:null};
  }
  saveFlow(flow);
  return {state,redirect:'',action:'https://github.com/settings/apps/new?state='+state,manifest:{name:'Salmon Isle '+url.hostname.replace(/[^a-zA-Z0-9-]/g,'-')+' '+state.slice(0,6),url:origin,public:false,redirect_url:origin+'/api/admin/git/github/manifest',setup_url:origin+'/api/admin/git/github/installed',callback_urls:[origin+'/api/admin/git/github/authorized'],hook_attributes:{url:origin+'/api/github/webhook',active:true},default_permissions:{contents:'write',metadata:'read'},default_events:['push'],request_oauth_on_install:false}};
}
export async function completeGithubManifest(state:string,code:string,session:string){
  const flow=readFlow(state,session,'manifest');if(!/^[a-zA-Z0-9_-]{1,200}$/.test(code))throw new AppError('GitHub 授权码无效');
  flow.stage='install';saveFlow(flow);
  try{
    const result=await githubRequest('/app-manifests/'+code+'/conversions',undefined,{});
    if(!Number.isInteger(result.id)||!result.pem||!result.client_id||!result.client_secret||!result.webhook_secret||!/^[a-zA-Z0-9-]+$/.test(result.slug))throw new AppError('GitHub 应用配置不完整',502);
    const repo=githubRepository(flow.remote);
    flow.app={appId:result.id,privateKey:result.pem,clientId:result.client_id,clientSecret:result.client_secret,webhookSecret:result.webhook_secret,slug:result.slug,origin:flow.origin,owner:repo.owner,repo:repo.repo};saveFlow(flow);
    return 'https://github.com/apps/'+result.slug+'/installations/new?state='+state;
  }catch(error){flow.stage='manifest';saveFlow(flow);throw error;}
}
export function beginGithubUserAuthorization(state:string,session:string){
  const flow=readFlow(state,session,'install');if(!flow.app)throw new AppError('授权配置缺失，请重新连接');
  flow.stage='oauth';saveFlow(flow);
  return 'https://github.com/login/oauth/authorize?'+new URLSearchParams({client_id:flow.app.clientId,redirect_uri:flow.origin+'/api/admin/git/github/authorized',state});
}
export async function completeGithubAuthorization(state:string,code:string,session:string){
  const flow=readFlow(state,session,'oauth'),app=flow.app;if(!app)throw new AppError('授权配置缺失');
  flow.stage='done';saveFlow(flow);
  try{
    const response=await fetch(oauthBase()+'/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:app.clientId,client_secret:app.clientSecret,code,redirect_uri:flow.origin+'/api/admin/git/github/authorized'}),signal:AbortSignal.timeout(20000)});
    const result=await response.json();if(!response.ok||typeof result.access_token!=='string')throw new AppError('GitHub 登录未完成，请重新授权',409);
    const installation=await githubRequest('/repos/'+app.owner+'/'+app.repo+'/installation',appJwt(app));
    let allowed=false;
    for(let page=1;page<=10&&!allowed;page++){const list=await githubRequest('/user/installations?per_page=100&page='+page,result.access_token);allowed=list.installations?.some((item:{id:number;app_id:number})=>item.id===installation.id&&item.app_id===app.appId);if((list.installations?.length||0)<100)break;}
    if(!allowed||installation.permissions?.contents!=='write')throw new AppError('当前 GitHub 用户未授权目标仓库的读写权限',403);
    app.installationId=installation.id;
    const repository=await githubRequest('/repos/'+app.owner+'/'+app.repo,result.access_token);app.repositoryId=repository.id;
    await githubRequest('/repos/'+app.owner+'/'+app.repo,await installationToken(app));atomicWrite(credentialFile(),JSON.stringify(app));
    fs.unlinkSync(flowFile(state));return {remote:flow.remote,branch:repository.default_branch||'main',origin:flow.origin};
  }catch(error){flow.stage='oauth';saveFlow(flow);throw error;}
}
export async function githubRepositoryInfo(remote:string){
  const parsed=githubRepository(remote),token=await githubGitToken(parsed.remote);
  if(!token)throw new AppError('请先完成 GitHub 授权',409);
  const data=await githubRequest('/repos/'+parsed.owner+'/'+parsed.repo,token);return {branch:String(data.default_branch||'main'),private:!!data.private};
}
export function verifyGithubWebhook(body:Buffer,signature:string){
  const app=credentials();if(!app||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;
  const expected='sha256='+createHmac('sha256',app.webhookSecret).update(body).digest('hex');
  return timingSafeEqual(Buffer.from(expected),Buffer.from(signature));
}
export function webhookMatchesRepository(input:{repository?:{id?:number};installation?:{id?:number}}){
  const app=credentials();return !!app?.repositoryId&&input.repository?.id===app.repositoryId&&input.installation?.id===app.installationId;
}

import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import appPackage from '../../package.json';
import {runtimeDir,isDesktop} from './library-context';
import {atomicWrite} from './storage';
import {AppError} from './model';
import {releaseFeed} from './releases';
const settingsFile=()=>path.join(runtimeDir(),'program-updates.json');
const releaseSchema=z.object({version:z.string().regex(/^\d+\.\d+\.\d+$/),notesUrl:z.string().url(),desktopFeed:z.string().url().optional(),dockerImage:z.string().regex(/^ghcr\.io\/[a-z0-9._/-]+:[a-zA-Z0-9._-]+$/).optional()});
type Release=z.infer<typeof releaseSchema>;
const cache=new Map<string,{release:Release;time:number}>();
function https(value:string){if(!value)return '';const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw new AppError('更新源必须使用不含凭据的 HTTPS 地址');return url.href;}
function releaseBase(){return releaseFeed();}
function settings(){const file=settingsFile();return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')) as {manifestUrl:string}:{manifestUrl:process.env.SALMON_RELEASE_MANIFEST_URL||(releaseBase()?releaseBase()+'release.json':'')};}
function newer(version:string,current:string){const a=version.split('.').map(Number),b=current.split('.').map(Number);for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;}
export function programInfo(){
  const config=settings(),latest=cache.get(config.manifestUrl)?.release;
  return {version:appPackage.version,syncProtocol:1,upgradeGuideUrl:'https://github.com/'+appPackage.repository.url.replace(/^https:\/\/github\.com\//,'').replace(/\.git$/,'')+'/releases/latest',desktopFeed:process.env.SALMON_DESKTOP_UPDATE_URL||latest?.desktopFeed||releaseBase()};
}
export function programUpdateStatus(){const config=settings(),entry=cache.get(config.manifestUrl);return {...programInfo(),manifestUrl:config.manifestUrl,latest:entry?.release||null,available:!!entry&&newer(entry.release.version,appPackage.version),checkedAt:entry?new Date(entry.time).toISOString():null};}
export function saveProgramUpdateSettings(manifestUrl:string){
  if(isDesktop())throw new AppError('网站更新源请在在线后台配置',403);
  const value=https(manifestUrl);atomicWrite(settingsFile(),JSON.stringify({manifestUrl:value},null,2));return programUpdateStatus();
}
export async function checkProgramUpdates(){
  const {manifestUrl}=settings();if(!manifestUrl)throw new AppError('尚未配置程序发布源，请填写源码项目发布的 release.json 地址');
  const url=https(manifestUrl);let response:Response;
  try{response=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-store'});}catch{throw new AppError('无法连接程序更新源，请稍后重试',502);}
  if(!response.ok)throw new AppError('更新源暂不可用，请确认 release.json 已发布',502);
  const raw=await response.text();if(Buffer.byteLength(raw)>65536)throw new AppError('更新信息过大');
  let result;try{result=releaseSchema.safeParse(JSON.parse(raw));}catch{throw new AppError('程序更新信息格式无效');}
  if(!result.success)throw new AppError('程序更新信息格式无效');
  https(result.data.notesUrl);if(result.data.desktopFeed)https(result.data.desktopFeed);
  cache.set(manifestUrl,{release:result.data,time:Date.now()});return programUpdateStatus();
}

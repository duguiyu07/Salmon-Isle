import fs from 'node:fs';
import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {cache} from 'react';

export interface RepositoryConfig {workspace:string;remote:string;branch:string;siteUrl:string}
export interface LibraryScope {root:string;readOnly?:boolean}
const scopes=new AsyncLocalStorage<LibraryScope>();
export function runtimeDir(){return path.resolve(process.env.SALMON_DATA_DIR||'./data');}
export function directLibraryRoot():string|null{const file=path.join(runtimeDir(),'direct-library.json');return fs.existsSync(file)?path.join(runtimeDir(),'library-v2'):null;}
export function repositoryConfig():RepositoryConfig|null{
  const saved=path.join(runtimeDir(),'library-connection.json');
  if(fs.existsSync(saved))return JSON.parse(fs.readFileSync(saved,'utf8')) as RepositoryConfig;
  if(process.env.SALMON_CONTENT_REPO_DIR)return {workspace:path.resolve(process.env.SALMON_CONTENT_REPO_DIR),remote:process.env.SALMON_CONTENT_REMOTE||'',branch:process.env.SALMON_CONTENT_BRANCH||'main',siteUrl:process.env.SALMON_SITE_URL||''};
  return null;
}
export function activeRevision():string|null{
  if(directLibraryRoot())return null;
  const file=path.join(runtimeDir(),'library-active.json');
  if(!fs.existsSync(file))return null;
  const {revision}=JSON.parse(fs.readFileSync(file,'utf8'));
  return typeof revision==='string'&&/^[a-f0-9]{40,64}$/.test(revision)?revision:null;
}
export function activeRoot(){
  const direct=directLibraryRoot();if(direct)return direct;
  const config=repositoryConfig();
  const revision=config&&activeRevision();
  return revision?path.join(runtimeDir(),'library-releases',revision):runtimeDir();
}
// React pins a release for an entire server render. Jobs and route handlers
// use withLibrary explicitly because React's cache is render-scoped.
const renderRoot=cache(activeRoot);
export function libraryRoot(){return scopes.getStore()?.root||renderRoot();}
export function libraryReadOnly(){return scopes.getStore()?.readOnly??(libraryRoot()!==runtimeDir());}
export function workspaceRoot(){return directLibraryRoot()||repositoryConfig()?.workspace||runtimeDir();}
export function withLibrary<T>(root:string,callback:()=>T,readOnly=false):T{return scopes.run({root,readOnly},callback);}
export function withWorkspace<T>(callback:()=>T):T{return withLibrary(workspaceRoot(),callback);}
export function withPublicLibrary<T>(callback:()=>T):T{return withLibrary(activeRoot(),callback,!!directLibraryRoot()||!!activeRevision());}
export function libraryPath(...parts:string[]){return path.join(libraryRoot(),...parts);}
export function assertLibraryWritable(){if(libraryReadOnly())throw new Error('已上线快照不能修改，请在编辑工作区操作');}

import fs from 'node:fs';
import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {workspaceRoot} from './library-context';
import {AppError} from './model';
const locks=new AsyncLocalStorage<string>();
export async function withRepositoryLock<T>(callback:()=>Promise<T>|T,root=workspaceRoot()):Promise<T>{
  const file=path.resolve(root)+'.salmon-lock';if(locks.getStore()===file)return callback();
  fs.mkdirSync(path.dirname(file),{recursive:true});const until=Date.now()+30000;
  for(;;){
    try{const fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({pid:process.pid,time:Date.now()}));fs.closeSync(fd);break;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      try{const owner=JSON.parse(fs.readFileSync(file,'utf8'));try{process.kill(owner.pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH'){fs.unlinkSync(file);continue;}}}catch{}
      if(Date.now()>until)throw new AppError('内容库正在执行另一项操作，请稍后重试',423);await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  try{return await locks.run(file,callback);}finally{fs.unlinkSync(file);}
}

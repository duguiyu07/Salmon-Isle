import fs from 'node:fs';
import path from 'node:path';
import {withLibrary} from './library-context';
import {atomicWrite} from './storage';
import {listMedia,writeMediaMetadata} from './media';
import {libraryDirectories,validateLibrary} from './library-validation';
import {AppError} from './model';
export async function createEmptyLibrary(root:string){for(const dir of libraryDirectories)fs.mkdirSync(path.join(root,dir),{recursive:true});atomicWrite(path.join(root,'library.json'),JSON.stringify({version:1})+'\n');}

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

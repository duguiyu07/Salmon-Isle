import fs from 'node:fs';
import path from 'node:path';
import {digest} from './crypto';
import {atomicWrite} from './storage';
import {libraryRoot,runtimeDir} from './library-context';
import {within} from './paths';

interface Transaction {root:string;done:boolean;files:{name:string;exists:boolean}[]}
function transactionDir(root:string){return path.join(runtimeDir(),'library-transactions',digest(path.resolve(root)));}
/** The journal lives outside Git. A process interrupted before completion rolls back. */
export function recoverLibraryTransaction(root=libraryRoot()){
  const dir=transactionDir(root),file=path.join(dir,'transaction.json');
  if(!fs.existsSync(file))return;
  const transaction=JSON.parse(fs.readFileSync(file,'utf8')) as Transaction;
  if(path.resolve(transaction.root)!==path.resolve(root))throw new Error('事务工作区不匹配');
  if(!transaction.done)for(const [index,entry] of transaction.files.entries()){
    const target=within(root,entry.name);
    if(entry.exists)atomicWrite(target,fs.readFileSync(path.join(dir,String(index))));
    else if(fs.existsSync(target))fs.unlinkSync(target);
  }
  fs.rmSync(dir,{recursive:true,force:true});
}
export function libraryTransaction<T>(names:string[],action:()=>T):T{
  const root=libraryRoot();recoverLibraryTransaction(root);
  const dir=transactionDir(root);fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const transaction:Transaction={root,done:false,files:[...new Set(names)].map(name=>({name,exists:fs.existsSync(within(root,name))}))};
  for(const [index,entry] of transaction.files.entries())if(entry.exists)fs.copyFileSync(within(root,entry.name),path.join(dir,String(index)));
  atomicWrite(path.join(dir,'transaction.json'),JSON.stringify(transaction));
  try{
    const result=action();atomicWrite(path.join(dir,'transaction.json'),JSON.stringify({...transaction,done:true}));
    recoverLibraryTransaction(root);return result;
  }catch(error){recoverLibraryTransaction(root);throw error;}
}

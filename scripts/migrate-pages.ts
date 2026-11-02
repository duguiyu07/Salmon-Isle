import path from 'node:path';
import {migratePages} from '../src/lib/page-migration';
import {backupData} from '../src/lib/backup';
import {atomicWrite} from '../src/lib/storage';
import {closeDatabases} from '../src/lib/db';

try{
  const apply=process.argv.includes('--apply'),preview=await migratePages(false);
  if(apply&&!preview.alreadyApplied){
    const backup=path.resolve('backups',`before-html-pages-${new Date().toISOString().replace(/[:.]/g,'-')}.zip`);
    atomicWrite(backup,Buffer.from(backupData()));console.log(JSON.stringify({backup}));
  }
  console.log(JSON.stringify(apply?await migratePages(true):preview,null,2));
}finally{closeDatabases();}

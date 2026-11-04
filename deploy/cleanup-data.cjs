/* Run only after a verified upgrade. The active library is never a target. */
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const retired=['history','backups','library-releases','library-candidates','library-archives','library-setup','content-repository','sync-blobs','content','media','media-meta','editor-drafts','trash'];

function measure(file){
  const stat=fs.lstatSync(file);
  if(stat.isSymbolicLink())throw new Error('Refusing symlink: '+file);
  if(!stat.isDirectory())return stat.size;
  return fs.readdirSync(file).reduce((bytes,name)=>bytes+measure(path.join(file,name)),0);
}
function cleanupPlan(directory){
  const root=fs.realpathSync(directory),marker=path.join(root,'direct-library.json'),active=path.join(root,'library-v2');
  if(!fs.existsSync(marker)||JSON.parse(fs.readFileSync(marker,'utf8')).version!==2)throw new Error('A completed direct-library migration is required');
  if(fs.lstatSync(active).isSymbolicLink()||fs.realpathSync(active)!==active||JSON.parse(fs.readFileSync(path.join(active,'library.json'),'utf8')).version!==1)throw new Error('Invalid active library');
  for(const name of ['content','media','media-meta','editor-drafts','trash'])if(!fs.statSync(path.join(active,name)).isDirectory())throw new Error('Incomplete active library');
  const entries=retired.filter(name=>fs.existsSync(path.join(root,name))).map(name=>({name,bytes:measure(path.join(root,name))}));
  return {root,active,entries};
}
function cleanupData(directory,apply=false){
  const plan=cleanupPlan(directory),databaseFile=path.join(plan.root,'state.sqlite');let database;
  try{
    if(fs.existsSync(databaseFile)){
      database=new DatabaseSync(databaseFile);database.exec('PRAGMA busy_timeout=10000');
      const tables=new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
      if(tables.has('sync_journal')&&database.prepare('SELECT COUNT(*) AS n FROM sync_journal').get().n)throw new Error('Unfinished writes must recover before cleanup');
      if(apply)for(const table of ['sync_outbox','sync_receipts','sync_devices','articles','media'])if(tables.has(table))database.exec('DELETE FROM '+table);
    }
    if(apply){
      for(const entry of plan.entries){const target=path.join(plan.root,entry.name);
        if(path.dirname(target)!==plan.root||target===plan.active)throw new Error('Unsafe cleanup target');
        fs.rmSync(target,{recursive:true,force:true});
      }
      if(database)database.exec('VACUUM; PRAGMA wal_checkpoint(TRUNCATE)');
    }
  }finally{database?.close();}
  return {applied:apply,active:'library-v2',entries:plan.entries,bytes:plan.entries.reduce((sum,entry)=>sum+entry.bytes,0)};
}
module.exports={cleanupData,cleanupPlan};
if(!module.parent){try{const args=process.argv.slice(2);if(!args[0])throw new Error('Usage: node cleanup-data.cjs DATA_DIRECTORY [--apply]');console.log(JSON.stringify(cleanupData(args[0],args.includes('--apply'))));}catch(error){console.error(error.message);process.exitCode=1;}}

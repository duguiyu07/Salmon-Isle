import fs from 'node:fs';
import path from 'node:path';
import { analyzeWordPress } from '../src/lib/wordpress';
import { repairImageCaptions } from '../src/lib/repair-captions';
import { articleMeta,atomicWrite,listArticles,writeImportedArticle } from '../src/lib/storage';
import { listMedia } from '../src/lib/media';
import { backupData } from '../src/lib/backup';
import { dataDir } from '../src/lib/paths';
import { closeDatabases } from '../src/lib/db';

async function main(){
  const input=process.argv.slice(2).find(arg=>!arg.startsWith('--'));
  if(!input)throw new Error('用法：npm run repair:captions -- <WordPress.xml> [--apply]');
  const apply=process.argv.includes('--apply');
  const analysis=analyzeWordPress(fs.readFileSync(path.resolve(input),'utf8'));
  const media=new Map(listMedia().map(m=>[m.id,m]));
  const sourceOf=(url:string)=>{const id=url.match(/^\/api\/media\/([^?]+)/)?.[1];const source=id?media.get(id)?.source:undefined;return source?.startsWith(analysis.site+':')?analysis.site+'/wp-content/uploads/'+source.slice(analysis.site.length+1):undefined;};
  const report:{mode:string;backup?:string;recovered:number;already:number;conflicts:number;articles:any[]}={mode:apply?'apply':'dry-run',recovered:0,already:0,conflicts:0,articles:[]};
  const repairs=listArticles().flatMap(article=>{
    const original=analysis.candidates.find(c=>c.meta.id===article.id);if(!original)return [];
    const repair=repairImageCaptions(article.body,original.body,sourceOf);
    if(!repair.recovered&&!repair.already&&!repair.conflicts.length)return [];
    report.recovered+=repair.recovered;report.already+=repair.already;report.conflicts+=repair.conflicts.length;
    report.articles.push({id:article.id,title:article.title,recovered:repair.recovered,already:repair.already,conflicts:repair.conflicts});
    return repair.changed?[{article,body:repair.body}]:[];
  });
  if(apply&&repairs.length){
    report.backup=path.resolve(`backups/before-caption-repair-${new Date().toISOString().replace(/[:.]/g,'-')}.zip`);
    fs.mkdirSync(path.dirname(report.backup),{recursive:true});fs.writeFileSync(report.backup,backupData(),{mode:0o600});
    for(const {article,body} of repairs)writeImportedArticle(articleMeta(article),body,article.folderId,true);
  }
  const output=path.join(dataDir(),apply?'caption-repair-report.json':'caption-repair-preview.json');
  atomicWrite(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({mode:report.mode,recovered:report.recovered,already:report.already,conflicts:report.conflicts,changedArticles:repairs.length,backup:report.backup,report:output},null,2));
  if(report.conflicts)process.exitCode=2;
}
try{await main();}catch(error){console.error((error as Error).message);process.exitCode=1;}finally{closeDatabases();}

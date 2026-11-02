import fs from 'node:fs';
import path from 'node:path';
import { analyzeWordPress } from '../src/lib/wordpress';
import { repairImportedBody } from '../src/lib/repair-import';
import { articleMeta,atomicWrite,getSettings,listArticles,listFolders,saveSettings,writeImportedArticle } from '../src/lib/storage';
import { dataDir } from '../src/lib/paths';
import { backupData } from '../src/lib/backup';
import { renderMarkdown } from '../src/lib/markdown';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import { visit } from 'unist-util-visit';

async function main(){
const input=process.argv.slice(2).find(arg=>!arg.startsWith('--'));
if(!input)throw new Error('用法：npm run repair:wordpress -- <WordPress.xml> [--apply]');
const apply=process.argv.includes('--apply');const xml=fs.readFileSync(path.resolve(input),'utf8');
const legacy=analyzeWordPress(xml,undefined,{legacyMath:true,legacyCode:true,legacyQueries:true,legacyCaptions:true});const fixed=analyzeWordPress(xml,undefined,{legacyCaptions:true});
const report:{mode:string;backup?:string;articles:any[];conflicts:number;changed:number}={mode:apply?'apply':'dry-run',articles:[],conflicts:0,changed:0};
if(apply){report.backup=path.resolve(`backups/before-content-repair-${new Date().toISOString().replace(/[:.]/g,'-')}.zip`);fs.mkdirSync(path.dirname(report.backup),{recursive:true});fs.writeFileSync(report.backup,backupData(),{mode:0o600});}
const parser=unified().use(remarkParse).use(remarkMath).use(remarkDirective);
for(const article of listArticles()){
  const old=legacy.candidates.find(c=>c.meta.id===article.id),next=fixed.candidates.find(c=>c.meta.id===article.id);if(!old||!next)continue;
  if(old.body===next.body&&article.template===next.meta.template)continue;
  const repair=repairImportedBody(article.body,old.body,next.body);const meta=articleMeta(article);
  if(next.meta.template==='collection'&&next.meta.collection){meta.template='collection';meta.collection=next.meta.collection;}
  const metadataChanged=JSON.stringify(meta)!==JSON.stringify(articleMeta(article));
  if(repair.changed||metadataChanged){report.changed++;if(apply)writeImportedArticle(meta,repair.body,article.folderId,true);}
  const tree=parser.parse(repair.body);let inline=0,display=0;visit(tree,(node:any)=>{if(node.type==='inlineMath')inline++;if(node.type==='math')display++;});
  const rendered=await renderMarkdown(repair.body);const errors=(rendered.html.match(/class="katex-error"/g)||[]).length;
  report.conflicts+=repair.conflicts.length;report.articles.push({id:article.id,title:article.title,changed:repair.changed||metadataChanged,conflicts:repair.conflicts,inline,display,katexErrors:errors});
}
if(apply&&!getSettings().knowledgeRootId){const blog=listFolders().find(f=>f.path==='博客');if(blog)saveSettings({...getSettings(),knowledgeRootId:blog.id});}
atomicWrite(path.join(dataDir(),apply?'round-two-repair-report.json':'round-two-repair-preview.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(report.conflicts)process.exitCode=2;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

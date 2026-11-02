import path from 'node:path';
import {parseVisualMarkdown,serializeVisualMarkdown} from '../src/lib/visual-schema';
import {createTestEditor,equivalentVisualDocuments} from '../tests/helpers/visual-editor';
import {atomicWrite,listArticles} from '../src/lib/storage';
import {dataDir} from '../src/lib/paths';
const setup=await createTestEditor({live:true});
const report:{articles:any[];passed:number;failed:number}={articles:[],passed:0,failed:0};
try{
  for(const article of listArticles().filter(article=>article.kind==='post')){
    try{
      const log=console.error;try{console.error=()=>{};setup.editor.action(ctx=>{const parsed=parseVisualMarkdown(ctx,article.body);const markdown=serializeVisualMarkdown(ctx,parsed);const reparsed=parseVisualMarkdown(ctx,markdown);if(!equivalentVisualDocuments(parsed,reparsed))throw new Error('Markdown 往返后的文档结构发生变化');});}finally{console.error=log;}
      report.passed++;report.articles.push({id:article.id,title:article.title,passed:true});
    }catch(error){report.failed++;report.articles.push({id:article.id,title:article.title,passed:false,error:(error as Error).message.slice(0,240)});}
  }
}finally{await setup.close();}
atomicWrite(path.join(dataDir(),'visual-roundtrip-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,failed:report.failed,issues:report.articles.filter(a=>!a.passed)},null,2));
if(report.failed)process.exitCode=1;

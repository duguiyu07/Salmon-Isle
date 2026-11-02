import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { analyzeWordPress } from '../src/lib/wordpress';
import { listArticles,listTrash,trashedArticleIds } from '../src/lib/storage';
import { renderMarkdown } from '../src/lib/markdown';
import { listMedia } from '../src/lib/media';
import { dataDir } from '../src/lib/paths';
import { verifyPassword } from '../src/lib/crypto';
async function main(){
 const file=process.argv[2];if(!file)throw new Error('用法：tsx scripts/verify-import.ts <WordPress.xml>');
 const xml=fs.readFileSync(file,'utf8');const analysis=analyzeWordPress(xml);const articles=listArticles();const trashed=trashedArticleIds();const media=listMedia();let rendered=0,protectedCount=0,remoteImages=0;
 for(const candidate of analysis.candidates){const article=articles.find(a=>a.id===candidate.meta.id);if(candidate.trash){assert.ok(trashed.has(candidate.meta.id));continue;}assert.ok(article,`missing ${candidate.meta.id}`);assert.equal(article.title,candidate.meta.title);assert.equal(article.status,candidate.meta.status);assert.equal(article.access,candidate.meta.access);assert.ok(Number.isFinite(Date.parse(article.createdAt)));assert.ok(Number.isFinite(Date.parse(article.updatedAt)));assert.deepEqual(article.aliases,candidate.meta.aliases);const {html}=await renderMarkdown(article.body);assert.ok(html||!article.body.trim());rendered++;if(article.access==='password')protectedCount++;remoteImages+=[...article.body.matchAll(/!\[[^\]]*\]\(https?:/g)].length;
   for(const match of (article.body+' '+(article.cover||'')).matchAll(/\/api\/media\/([a-zA-Z0-9-]+)\?article=([^\s)]+)/g)){assert.ok(media.some(m=>m.id===match[1]));assert.ok(fs.existsSync(path.join(dataDir(),'media',match[1])));}
 }
 const root=new XMLParser({parseTagValue:false}).parse(xml);let passwordsVerified=0;for(const item of root.rss.channel.item){if(item['wp:post_password']){const article=articles.find(a=>a.source?.id===String(item['wp:post_id']));assert.ok(article);assert.ok(verifyPassword(String(item['wp:post_password']),article.passwordHash));passwordsVerified++;}}
 const report={verifiedAt:new Date().toISOString(),sourceItems:analysis.candidates.length,active:articles.length,posts:articles.filter(a=>a.kind==='post').length,pages:articles.filter(a=>a.kind==='page').length,published:articles.filter(a=>a.status==='published').length,drafts:articles.filter(a=>a.status==='draft').length,trash:listTrash().length,protected:protectedCount,passwordsVerified,rendered,localMedia:media.length,remainingRemoteImages:remoteImages,issues:JSON.parse(fs.readFileSync(path.join(dataDir(),'last-import-report.json'),'utf8')).warnings.length};
 fs.writeFileSync(path.join(dataDir(),'import-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});

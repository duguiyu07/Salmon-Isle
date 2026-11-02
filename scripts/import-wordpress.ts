import fs from 'node:fs';
import path from 'node:path';
import { analyzeWordPress,commitImport } from '../src/lib/wordpress';
import { initDirs,dataDir } from '../src/lib/paths';
const args=process.argv.slice(2);const value=(flag:string)=>{const i=args.indexOf(flag);return i>=0?args[i+1]:undefined;};
const xml=value('--xml');if(!xml){console.error('用法：npm run import:wordpress -- --xml <WXR.xml> [--media-dir <uploads>] [--profile <id>] [--apply] [--update]');process.exit(1);}
const analysis=analyzeWordPress(fs.readFileSync(path.resolve(xml),'utf8'),value('--profile'));
console.log(JSON.stringify({site:analysis.site,profile:analysis.profileId,articles:analysis.candidates.filter(c=>c.meta.kind==='post').length,pages:analysis.candidates.filter(c=>c.meta.kind==='page').length,duplicates:analysis.candidates.filter(c=>c.duplicate).length,warnings:analysis.warnings.length,trash:analysis.candidates.filter(c=>c.trash).length},null,2));
if(!args.includes('--apply')){console.log('预览完成。添加 --apply 才会写入正式内容目录。');process.exit(0);}
const result=commitImport(analysis,analysis.candidates.map(c=>({id:c.meta.id,selected:true,update:args.includes('--update'),folder:c.folder})),{mediaRoot:value('--media-dir'),rootFolder:value('--root')});
initDirs();fs.writeFileSync(path.join(dataDir(),'last-import-report.json'),JSON.stringify({time:new Date().toISOString(),...result,conversionWarnings:analysis.warnings},null,2),{mode:0o600});
console.log(JSON.stringify({...result,ids:undefined,warnings:result.warnings.length},null,2));
console.log('完整报告已保存到 data/last-import-report.json（包含原文标题，仅供管理员查看）。');

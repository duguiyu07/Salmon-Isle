import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const output=path.resolve('public/fonts');await fs.mkdir(output,{recursive:true});
const urls=[
  'https://cdn.jsdelivr.net/npm/@chinese-fonts/lxgwwenkaibright/dist/LXGWBright-Regular/result.css',
  'https://cdn.jsdelivr.net/npm/@chinese-fonts/pfmmd/dist/平方萌萌哒/result.css'
];
let css='';
for(const url of urls){
 const response=await fetch(url);if(!response.ok)throw new Error(`Font stylesheet: ${response.status}`);let part=await response.text();
 const assets=[...new Set([...part.matchAll(/url\(([^)]+)\)/g)].map(m=>m[1].replace(/["']/g,'')))];
 for(let index=0;index<assets.length;index+=6){await Promise.all(assets.slice(index,index+6).map(async asset=>{const source=new URL(asset,url);const name=crypto.createHash('sha256').update(source.href).digest('hex').slice(0,20)+'.woff2';const file=path.join(output,name);try{await fs.access(file);}catch{const r=await fetch(source);if(!r.ok)throw new Error(`Font asset: ${r.status}`);await fs.writeFile(file,Buffer.from(await r.arrayBuffer()));}const bytes=await fs.readFile(file),fingerprint=crypto.createHash('sha256').update(bytes).digest('hex').slice(0,20)+'.woff2';await fs.writeFile(path.join(output,fingerprint),bytes);part=part.split(asset).join('/fonts/'+fingerprint);}));}
 css+=part+'\n';console.log(`Vendored ${assets.length} font segments.`);
}
await fs.writeFile(path.join(output,'fonts.css'),css);
const license=await fetch('https://cdn.jsdelivr.net/gh/lxgw/LxgwBright@main/OFL.txt');
if(!license.ok)throw new Error(`Font license: ${license.status}`);
await fs.writeFile(path.join(output,'OFL-LXGW.txt'),await license.text());

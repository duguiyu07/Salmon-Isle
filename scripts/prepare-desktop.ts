import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {releaseFeed} from '../src/lib/releases';
const root=process.cwd(),target=path.join(root,'desktop','web'),standalone=path.join(root,'.next','standalone');
if(!fs.existsSync(path.join(standalone,'server.js')))throw new Error('请先运行 npm run build');
// This target is a generated packaging directory, never a content workspace.
if(path.resolve(target)!==path.join(root,'desktop','web'))throw new Error('Unsafe packaging path');
fs.rmSync(target,{recursive:true,force:true});fs.cpSync(standalone,target,{recursive:true,dereference:true});
fs.cpSync(path.join(root,'public'),path.join(target,'public'),{recursive:true});fs.cpSync(path.join(root,'.next','static'),path.join(target,'.next','static'),{recursive:true});
for(const name of ['data','backups','原网站内容','deploy-input','deploy-secrets','restored-data','content-test','dist','.env','.env.local'])if(fs.existsSync(path.join(target,name)))throw new Error('打包目录包含私有数据：'+name);
// ICO is constructed from the existing brand PNG using PNG-compressed ICO.
const png=await sharp(path.join(root,'public','brand','logo.png')).resize(256,256,{fit:'contain',background:'#00000000'}).png().toBuffer();const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=0;header[7]=0;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);fs.writeFileSync(path.join(root,'desktop','icon.ico'),Buffer.concat([header,png]));
console.log('桌面 standalone 资源已准备：'+target);
const updateUrl=process.env.SALMON_DESKTOP_UPDATE_URL||releaseFeed();
if(updateUrl&&new URL(updateUrl).protocol!=='https:')throw new Error('桌面更新目录必须使用 HTTPS');
fs.writeFileSync(path.join(root,'desktop','update-defaults.json'),JSON.stringify({url:updateUrl,...(process.env.SALMON_PUBLISHER_NAME?{publisherName:process.env.SALMON_PUBLISHER_NAME.split('|')}:{})},null,2));

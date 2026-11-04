import fs from 'node:fs';
import path from 'node:path';
import appPackage from '../package.json';
import {sourcePackage} from '../src/lib/source-package';

const {bytes, paths} = sourcePackage(process.cwd(), appPackage.version);
const option = process.argv.indexOf('--output');
const target = path.resolve(option >= 0 ? process.argv[option + 1] : `dist/deployment/public/Salmon-Isle-Source-${appPackage.version}.zip`);
fs.mkdirSync(path.dirname(target), {recursive: true});
fs.writeFileSync(target, bytes);
console.log(`源码包已生成：${target}（${paths.length} 个文件；不含实际内容、依赖、凭据或构建目录）`);

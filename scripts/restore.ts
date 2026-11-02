import fs from 'node:fs';
import path from 'node:path';
import { restoreData } from '../src/lib/backup';
const [archive,target]=process.argv.slice(2);if(!archive||!target){console.error('用法：npm run restore -- <备份.zip> <空的恢复目录>');process.exit(1);}restoreData(fs.readFileSync(path.resolve(archive)),target);console.log(`恢复完成：${path.resolve(target)}`);

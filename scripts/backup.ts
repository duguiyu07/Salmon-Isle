import fs from 'node:fs';
import path from 'node:path';
import { backupData } from '../src/lib/backup';
const output=path.resolve(process.argv[2]||`backups/salmon-isle-${new Date().toISOString().replace(/[:.]/g,'-')}.zip`);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,backupData(),{mode:0o600});console.log(`备份已保存：${output}`);

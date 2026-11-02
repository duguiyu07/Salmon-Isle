import fs from 'node:fs';
import path from 'node:path';
import { dataDir,initDirs } from '../src/lib/paths';
import { token } from '../src/lib/crypto';
import { adminHash } from '../src/lib/auth';
initDirs();
if(adminHash()){console.log('管理员已配置。访问 /admin 登录。');process.exit(0);}
const file=path.join(dataDir(),'setup-token');if(!fs.existsSync(file))fs.writeFileSync(file,token(),{mode:0o600});
console.log('在浏览器打开 /admin/login，使用以下一次性令牌设置管理密码：');
console.log(fs.readFileSync(file,'utf8').trim());
console.log('初始化后令牌立即作废。请勿把 data 目录放到公开目录。');

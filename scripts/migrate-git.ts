import {migrateGit} from '../src/lib/git-migration';
import {closeDatabases} from '../src/lib/db';
const args=process.argv.slice(2),index=args.indexOf('--target'),target=index>=0?args[index+1]:undefined;
if(!target){console.error('用法：npm run migrate:git -- --target <独立内容仓库目录> [--apply]');process.exitCode=1;}
else try{console.log(JSON.stringify(await migrateGit(target,args.includes('--apply')),null,2));}catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=1;}finally{closeDatabases();}

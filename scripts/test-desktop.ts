import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const artifacts=path.resolve('.qa-artifacts');fs.mkdirSync(artifacts,{recursive:true});
const dataArgument=process.argv.indexOf('--data-dir');
const data=dataArgument>=0?path.resolve(process.argv[dataArgument+1]):fs.mkdtempSync(path.join(artifacts,'desktop-'));
if(!data.startsWith(artifacts+path.sep))throw new Error('Desktop test data must stay inside .qa-artifacts');
fs.mkdirSync(data,{recursive:true});
const argument=process.argv.indexOf('--executable'),executable=argument>=0?path.resolve(process.argv[argument+1]):path.resolve('desktop/node_modules/electron/dist/electron.exe');
const environment={...process.env};
if(process.argv.includes('--no-system-tools')){for(const key of Object.keys(environment))if(key.toUpperCase()==='PATH'||key==='NODE_PATH')delete environment[key];environment.PATH=path.join(process.env.SystemRoot||'C:\\Windows','System32');}
const child=spawn(executable,argument>=0?['--smoke']:[path.resolve('desktop'),'--smoke'],{env:{...environment,SALMON_DESKTOP_DATA_DIR:data},windowsHide:true,stdio:'inherit'});
child.on('error',error=>{console.error(error);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});

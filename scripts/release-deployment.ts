import fs from 'node:fs';
import path from 'node:path';
import appPackage from '../package.json';
import {sourcePackage} from '../src/lib/source-package';
import {fileHash} from '../src/lib/deployment';
import {createTarGzip} from '../src/lib/tar-archive';

const root = process.cwd(), output = path.resolve('dist/deployment'), publicDir = path.join(output, 'public');
fs.mkdirSync(publicDir, {recursive: true});
const sourceFile = path.join(publicDir, `Salmon-Isle-Source-${appPackage.version}.zip`);
const source = sourcePackage(root, appPackage.version);
fs.writeFileSync(sourceFile, source.bytes);
const server = path.join(output, 'server-files'); fs.mkdirSync(path.join(server, 'scripts'), {recursive: true});
const copies: [string, string][] = [
  ['deploy/production.compose.yml', 'compose.yml'], ['deploy/production.env.example', '.env.example'],
  ['deploy/baota-proxy.conf', 'baota-proxy.conf'], ['scripts/update-site.sh', 'scripts/update-site.sh'], ['scripts/update-site.ps1', 'scripts/update-site.ps1'], ['docs/upgrade-2.0.zh-CN.md', '升级到2.0.md'],
  ['deploy/backup-site.sh', 'scripts/backup-site.sh'], ['deploy/restore-site.sh', 'scripts/restore-site.sh']
];
for (const [from, to] of copies) fs.writeFileSync(path.join(server, to), fs.readFileSync(path.join(root, from), 'utf8').replaceAll('\r\n', '\n'));
const serverFile = path.join(publicDir, `Salmon-Isle-Server-${appPackage.version}.tar.gz`);
createTarGzip(serverFile, server, copies.map(([, to]) => to));
fs.copyFileSync('docs/deployment-guide.zh-CN.md', path.join(output, '操作指南.md'));
fs.writeFileSync(path.join(output, 'README-FIRST.txt'),
  '先阅读 操作指南.md。\npublic/ 可公开；private/ 包含私人文章、草稿、密码散列和备份，不要上传到 GitHub。\n只有 private/migration-report.json 中 ready 为 true 时，报告内 archive 指向的数据包才可用于部署。\n');
fs.writeFileSync(path.join(publicDir, 'source-package-report.json'), JSON.stringify({version: appPackage.version,
  files: source.paths.length, includesLicense: true, includesDeployment: true, privatePathsIncluded: false}, null, 2) + '\n');
const publicFiles = [sourceFile, serverFile, path.join(publicDir, 'source-package-report.json')];
fs.writeFileSync(path.join(publicDir, 'SHA256SUMS.txt'), publicFiles.map(file => `${fileHash(file)}  ${path.basename(file)}`).join('\n') + '\n');
console.log('部署交付文件已准备：' + output);
console.log('公开源码文件数：' + source.paths.length + '。私有数据需另运行 prepare:deployment；本命令不发布 GitHub、不访问服务器。');

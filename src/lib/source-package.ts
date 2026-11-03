import fs from 'node:fs';
import path from 'node:path';
import {zipSync, unzipSync} from 'fflate';
import {parseDocument} from 'yaml';

const directories = ['src', 'scripts', 'tests', 'docs', 'public', 'desktop', '.github', 'deploy'];
const files = ['package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'next-env.d.ts',
  'postcss.config.mjs', 'Dockerfile', 'compose.yml', '.dockerignore', '.gitignore', '.gitattributes', '.env.example',
  'README.md', 'AGENTS.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
const ignored = new Set(['node_modules', 'web', 'icon.ico', 'update-defaults.json', '.git', 'data',
  'backups', 'dist', 'restored-data', 'content-test', 'deploy-input', 'deploy-secrets', 'publish-workspace']);

export function privateSourcePath(relative: string) {
  return relative.split('/').some(name => ignored.has(name) || name.startsWith('.env') && name !== '.env.example') ||
    /\.(?:xml|sqlite(?:-shm|-wal)?|pem|key|p12|pfx|zip|gz|exe|blockmap|salmon-lock|log)$/i.test(relative);
}

export function sourcePackage(root: string, version: string) {
  const prefix = `Salmon-Isle-Source-${version}/`, entries: Record<string, Uint8Array> = {};
  function add(relative: string) {
    if (privateSourcePath(relative)) return;
    const file = path.join(root, relative), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('源码包不允许符号链接：' + relative);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) add(path.posix.join(relative, name));
    else {
      const bytes = fs.readFileSync(file);
      if (relative.startsWith('.github/workflows/') && /\.ya?ml$/i.test(relative)) {
        const document = parseDocument(bytes.toString('utf8'));
        if (document.errors.length) throw new Error('工作流 YAML 语法错误：' + relative + '\n' + document.errors.map(error => error.message).join('\n'));
      }
      entries[prefix + relative] = bytes;
    }
  }
  for (const dir of directories) add(dir);
  for (const file of files) if (fs.existsSync(path.join(root, file))) add(file);
  const bytes = zipSync(entries, {level: 6});
  const paths = Object.keys(unzipSync(bytes));
  if (paths.some(file => !file.startsWith(prefix) || privateSourcePath(file.slice(prefix.length)))) throw new Error('源码包包含非公开路径');
  return {bytes, paths};
}

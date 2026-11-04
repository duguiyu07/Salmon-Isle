import fs from 'node:fs';
import path from 'node:path';
import {runtimeDir,libraryRoot,libraryReadOnly} from './library-context';
export function dataDir() { return runtimeDir(); }
export function initDirs() {
  for(const d of ['', 'imports'])fs.mkdirSync(path.join(dataDir(),d),{recursive:true});
  if(!libraryReadOnly())for(const d of ['content','media','media-meta','trash','editor-drafts'])fs.mkdirSync(path.join(libraryRoot(),d),{recursive:true});
}
export function within(base: string, relative: string) {
  if (path.isAbsolute(relative) || relative.includes('\0') || relative.includes('\\')) throw new Error('无效路径');
  const target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error('路径超出内容目录');
  let current = base;
  for (const part of path.relative(base, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('不允许符号链接');
  }
  return target;
}
export function contentPath(relative = '') { initDirs(); return within(path.join(libraryRoot(), 'content'), relative); }
export function safeName(input: string) {
  const name = input.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100);
  if (!name || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) throw new Error('名称不能为空或使用系统保留名称');
  return name;
}
export function relativePath(absolute: string) { return path.relative(contentPath(), absolute).split(path.sep).join('/'); }

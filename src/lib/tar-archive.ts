import path from 'node:path';
import {create} from 'tar';

/** Use the same archive implementation on Windows and Linux, independent of PATH. */
export function createTarGzip(file: string, cwd: string, entries: string[]) {
  try {
    create({file: path.resolve(file), cwd: path.resolve(cwd), gzip: true, sync: true, portable: true, strict: true}, entries);
  } catch (error) {
    throw new Error('tar.gz 打包失败：' + (error instanceof Error ? error.message : String(error)), {cause: error});
  }
}

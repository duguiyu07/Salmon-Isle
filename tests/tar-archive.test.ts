import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {extract, list} from 'tar';
import {createTarGzip} from '../src/lib/tar-archive';

test('tar.gz archives round trip Unicode files with spaces without a system tar command', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'salmon-tar-'));
  const previousPath = process.env.PATH;
  try {
    const source = path.join(root, 'source with spaces'), restored = path.join(root, 'restored');
    fs.mkdirSync(path.join(source, 'data', '中文目录'), {recursive: true}); fs.mkdirSync(restored);
    const relative = 'data/中文目录/带空格的 文件.md', contents = Buffer.from('正文与图片引用\n');
    fs.writeFileSync(path.join(source, relative), contents);
    const archive = path.join(root, '站点 数据.tar.gz');
    process.env.PATH = '';
    createTarGzip(archive, source, ['data']);
    const entries: string[] = [];
    list({file: archive, sync: true, onReadEntry: entry => entries.push(entry.path)});
    assert.ok(entries.includes(relative));
    assert.ok(entries.every(entry => entry.startsWith('data/')));
    extract({file: archive, cwd: restored, sync: true});
    assert.deepEqual(fs.readFileSync(path.join(restored, relative)), contents);
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    assert.ok(root.startsWith(path.join(os.tmpdir(), 'salmon-tar-')));
    fs.rmSync(root, {recursive: true, force: true});
  }
});

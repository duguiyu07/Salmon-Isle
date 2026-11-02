import {test, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {copyLibrary} from '../src/lib/git-migration';
import {saveArticle, saveFolder, findArticle, listFolders} from '../src/lib/storage';
import {addMedia, getMedia} from '../src/lib/media';
import {withLibrary} from '../src/lib/library-context';
import {libraryDirectories} from '../src/lib/library-validation';
import {closeDatabases} from '../src/lib/db';

let root: string;
const previous = {...process.env};
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'salmon-copy-'));
  for (const key of Object.keys(process.env)) if (key.startsWith('SALMON_')) delete process.env[key];
  process.env.SALMON_DATA_DIR = path.join(root, 'source');
});
afterEach(() => {
  closeDatabases();
  for (const key of Object.keys(process.env)) if (key.startsWith('SALMON_')) delete process.env[key];
  Object.assign(process.env, Object.fromEntries(Object.entries(previous).filter(([key]) => key.startsWith('SALMON_'))));
  assert.ok(root.startsWith(path.join(os.tmpdir(), 'salmon-copy-')));
  fs.rmSync(root, {recursive: true, force: true});
});

test('copyLibrary preserves nested content and exports legacy SQLite media to an absent target', async () => {
  const folder = saveFolder({name: '技术'});
  const article = saveArticle({title: '保持 ID', body: '原始内容', status: 'published', folderId: folder.id});
  const media = addMedia('example.png', Buffer.from([137, 80, 78, 71]), article.id);
  // Legacy data may have media records only in SQLite.
  fs.unlinkSync(path.join(process.env.SALMON_DATA_DIR!, 'media-meta', media.id + '.json'));
  const sourceBytes = fs.readFileSync(path.join(process.env.SALMON_DATA_DIR!, 'content', article.path));
  const target = path.join(root, 'target');
  const summary = await copyLibrary(process.env.SALMON_DATA_DIR!, target);
  assert.equal(summary.articles, 1); assert.equal(summary.media, 1);
  for (const dir of libraryDirectories) assert.ok(fs.statSync(path.join(target, dir)).isDirectory());
  assert.equal(withLibrary(target, () => findArticle(article.id)?.folderId), folder.id);
  assert.equal(withLibrary(target, () => getMedia(media.id)?.name), media.name);
  assert.ok(withLibrary(target, () => listFolders()).some(item => item.id === folder.id));
  assert.deepEqual(fs.readFileSync(path.join(process.env.SALMON_DATA_DIR!, 'content', article.path)), sourceBytes);
  assert.equal(fs.existsSync(path.join(target, 'state.sqlite')), false);
});

test('copyLibrary rejects pre-existing managed directories before changing any target files', async () => {
  const article = saveArticle({title: '源文章', body: 'source'});
  for (const dir of libraryDirectories) {
    const target = path.join(root, 'target-' + dir);
    fs.mkdirSync(path.join(target, dir), {recursive: true});
    fs.writeFileSync(path.join(target, 'library.json'), 'KEEP MARKER');
    fs.writeFileSync(path.join(target, '.gitattributes'), 'KEEP ATTRIBUTES');
    fs.writeFileSync(path.join(target, dir, 'existing.txt'), 'KEEP CONTENT');
    await assert.rejects(copyLibrary(process.env.SALMON_DATA_DIR!, target), /已有内容目录/);
    assert.equal(fs.readFileSync(path.join(target, dir, 'existing.txt'), 'utf8'), 'KEEP CONTENT');
    assert.equal(fs.readFileSync(path.join(target, 'library.json'), 'utf8'), 'KEEP MARKER');
    assert.equal(fs.readFileSync(path.join(target, '.gitattributes'), 'utf8'), 'KEEP ATTRIBUTES');
    assert.equal(findArticle(article.id)?.body.trim(), 'source');
  }
});

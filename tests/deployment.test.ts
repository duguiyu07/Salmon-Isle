import {test, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {list} from 'tar';
import {unzipSync} from 'fflate';
import {DatabaseSync} from 'node:sqlite';
import {deploymentWordPress, missingUploads, pageFingerprints, fileHash, legacyUploadPaths} from '../src/lib/deployment';
import {prepareDeploymentData} from '../src/lib/deployment-data';
import {sourcePackage} from '../src/lib/source-package';
import {saveArticle, saveFolder, listArticles, listFolders, listTrash, trashItem, getSettings, saveSettings} from '../src/lib/storage';
import {analyzeWordPress, commitImport} from '../src/lib/wordpress';
import {verifyPassword} from '../src/lib/crypto';
import {closeDatabases} from '../src/lib/db';

let root: string, originalDataDir: string | undefined;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'salmon-deployment-'));
  originalDataDir = process.env.SALMON_DATA_DIR;
  process.env.SALMON_DATA_DIR = path.join(root, 'original');
});
afterEach(() => {
  closeDatabases();
  if (originalDataDir === undefined) delete process.env.SALMON_DATA_DIR; else process.env.SALMON_DATA_DIR = originalDataDir;
  assert.ok(root.startsWith(path.join(os.tmpdir(), 'salmon-deployment-')));
  fs.rmSync(root, {recursive: true, force: true});
});

const envelope = (body: string) => `<?xml version="1.0"?><rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Fixture</title><link>https://example.test</link><wp:wxr_version>1.2</wp:wxr_version><wp:base_site_url>https://example.test</wp:base_site_url>${body}</channel></rss>`;
const post = (id: number, status = 'publish', body = '<p>新的正文</p>') => `<item><title>Post ${id}</title><link>https://example.test/archives/${id}</link><wp:post_type>post</wp:post_type><wp:post_id>${id}</wp:post_id><wp:status>${status}</wp:status><wp:post_date_gmt>2026-10-01 00:00:00</wp:post_date_gmt><wp:post_modified_gmt>2026-11-01 00:00:00</wp:post_modified_gmt><wp:post_password>${id === 1 ? 'fixture-password' : ''}</wp:post_password><category domain="category" nicename="code">技术</category><content:encoded><![CDATA[${body}]]></content:encoded></item>`;
const reference = envelope(`<wp:category><wp:category_nicename>blog</wp:category_nicename><wp:cat_name>博客</wp:cat_name></wp:category><wp:category><wp:category_nicename>code</wp:category_nicename><wp:category_parent>blog</wp:category_parent><wp:cat_name>技术</wp:cat_name></wp:category><item><wp:post_type>wp_global_styles</wp:post_type><wp:post_name>wp-global-styles-fixture</wp:post_name><content:encoded><![CDATA[{"styles":{"blocks":{"core/group":{"variations":{"section-2":{"border":{"radius":"9px"}}}}}}}]]></content:encoded></item>${post(999)}`);
const image = '<!-- wp:image --><figure><img src="https://example.test/wp-content/uploads/2026/11/test.png"/></figure><!-- /wp:image -->';

function seed() {
  const blog = saveFolder({name: '博客'}), code = saveFolder({name: '技术', parentId: blog.id});
  saveSettings({...getSettings(), knowledgeRootId: blog.id});
  for (const route of ['/', '/about', '/knowledge', '/misc', '/links']) saveArticle({kind: 'page', title: route,
    contentFormat: 'html', route, css: '.sample { color: red; }', body: '<p>现有页面</p>', status: 'published'});
  fs.writeFileSync(path.join(process.env.SALMON_DATA_DIR!, 'admin.json'), JSON.stringify({hash: 'fixture-admin-hash'}));
  return {blog, code};
}

test('deployment borrows category hierarchy and themes without reference articles or overwriting pages', () => {
  const {code} = seed();
  const input = envelope(post(1, 'publish', '<!-- wp:group {"className":"is-style-section-2"} --><div><p>Body</p></div><!-- /wp:group -->'));
  assert.throws(() => deploymentWordPress(input), /缺少分类/);
  assert.throws(() => deploymentWordPress(input, reference.replaceAll('example.test', 'other.test')), /来源站点不同/);
  const prepared = deploymentWordPress(input, reference), analysis = analyzeWordPress(prepared.xml);
  assert.equal(analysis.candidates.length, 1);
  assert.equal(analysis.candidates[0].folder, '博客/技术');
  assert.match(analysis.candidates[0].body, /radius="9px"/);
  const before = pageFingerprints(process.env.SALMON_DATA_DIR!);
  commitImport(analysis, analysis.candidates.map(c => ({id: c.meta.id, selected: true, update: true})));
  assert.equal(listArticles().find(a => a.kind === 'post')!.folderId, code.id);
  assert.deepEqual(pageFingerprints(process.env.SALMON_DATA_DIR!), before);
  assert.equal(prepared.summary.borrowedCategories, 2);
});

test('only referenced uploads, including covers and variants, gate the private deployment archive', () => {
  seed();
  const xml = envelope(post(1, 'publish', image) + post(2, 'draft') + post(3, 'trash') +
    '<item><wp:post_type>attachment</wp:post_type><wp:post_id>900</wp:post_id><wp:attachment_url>https://example.test/wp-content/uploads/unused.png</wp:attachment_url></item>');
  const input = path.join(root, 'new.xml'), old = path.join(root, 'old.xml'), media = path.join(root, 'uploads');
  fs.writeFileSync(input, xml); fs.writeFileSync(old, reference); fs.mkdirSync(media);
  const initialPages = pageFingerprints(process.env.SALMON_DATA_DIR!);
  const options = {sourceDir: process.env.SALMON_DATA_DIR!, xmlFile: input, mediaRoot: media, referenceXml: old, outputDir: path.join(root, 'delivery')};
  const failed = prepareDeploymentData(options).report;
  assert.equal(failed.ready, false); assert.equal(failed.archive, null);
  assert.deepEqual(failed.missingUploads.map((value: {relative: string}) => value.relative), ['2026/11/test.png']);
  assert.equal(failed.pages.unchanged, true);
  assert.deepEqual(pageFingerprints(options.sourceDir), initialPages);
  assert.equal(listArticles().filter(a => a.kind === 'post').length, 0, 'original data was not imported into');
  fs.mkdirSync(path.join(media, '2026/11'), {recursive: true});
  fs.writeFileSync(path.join(media, '2026/11/test.png'), Buffer.from([137, 80, 78, 71]));
  const passed = prepareDeploymentData(options).report;
  assert.equal(passed.ready, true, JSON.stringify(passed.errors));
  assert.deepEqual(passed.articles, {active: 2, published: 1, draft: 1, password: 1, xmlTrash: 1});
  assert.equal(passed.sha256, fileHash(passed.archive));
  const entries: string[] = [];
  list({file: passed.archive, sync: true, onReadEntry: entry => entries.push(entry.path)});
  assert.match(entries.join('\n'), /data\/state.sqlite/);
  assert.doesNotMatch(entries.join('\n'), /state\.sqlite-wal|before-import|setup-token|new\.xml/);
  const sqlite = new DatabaseSync(path.join(path.dirname(passed.staging), 'export/data/state.sqlite'), {readOnly: true});
  assert.equal(sqlite.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok'); sqlite.close();
  process.env.SALMON_DATA_DIR = passed.staging;
  assert.ok(verifyPassword('fixture-password', listArticles().find(a => a.source?.id === '1')!.passwordHash!));
  assert.equal(listTrash().filter(t => t.kind === 'article').length, 1);
});

test('WXR status is authoritative for previously trashed posts and new WXR pages are not imported', () => {
  seed();
  const prepared = deploymentWordPress(envelope(post(1)), reference), a = analyzeWordPress(prepared.xml);
  commitImport(a, a.candidates.map(c => ({id: c.meta.id, selected: true})));
  trashItem(a.candidates[0].meta.id, 'article');
  const xml = envelope(post(1) + post(5).replace('<wp:post_type>post</wp:post_type>', '<wp:post_type>page</wp:post_type>'));
  const file = path.join(root, 'new.xml'), old = path.join(root, 'old.xml'); fs.writeFileSync(file, xml); fs.writeFileSync(old, reference);
  const result = prepareDeploymentData({sourceDir: process.env.SALMON_DATA_DIR!, xmlFile: file, referenceXml: old,
    mediaRoot: path.join(root, 'uploads'), outputDir: path.join(root, 'delivery')}).report;
  assert.equal(result.ready, true, JSON.stringify(result.errors)); assert.equal(result.articles.published, 1);
  assert.equal(result.pages.routes.length, 5);
  assert.equal(listArticles().filter(a => a.kind === 'post').length, 0, 'original remains in trash');
});

test('media preflight checks thumbnail-only references and excludes other domains', () => {
  const xml = envelope(post(1).replace('</item>', '<wp:postmeta><wp:meta_key>_thumbnail_id</wp:meta_key><wp:meta_value>7</wp:meta_value></wp:postmeta></item>') +
    '<item><wp:post_type>attachment</wp:post_type><wp:post_id>7</wp:post_id><wp:attachment_url>https://example.test/wp-content/uploads/cover.png</wp:attachment_url></item>');
  const prepared = deploymentWordPress(xml, reference);
  assert.equal(missingUploads(prepared.references, root)[0].relative, 'cover.png');
  assert.deepEqual(legacyUploadPaths('![x](https://external.test/wp-content/uploads/external.png)', 'https://example.test'), []);
  assert.throws(() => deploymentWordPress('<!DOCTYPE x><rss/>'), /DTD/);
});

test('an identical previously trashed draft stays in trash after authoritative preparation', () => {
  seed();
  const input = deploymentWordPress(envelope(post(3, 'trash')), reference), analysis = analyzeWordPress(input.xml);
  commitImport(analysis, analysis.candidates.map(c => ({id: c.meta.id, selected: true})));
  const file = path.join(root, 'new.xml'), old = path.join(root, 'old.xml');
  fs.writeFileSync(file, envelope(post(3, 'trash'))); fs.writeFileSync(old, reference);
  const result = prepareDeploymentData({sourceDir: process.env.SALMON_DATA_DIR!, xmlFile: file, referenceXml: old,
    mediaRoot: root, outputDir: path.join(root, 'delivery')}).report;
  assert.equal(result.ready, true, JSON.stringify(result.errors));
  assert.equal(result.articles.active, 0); assert.equal(result.articles.xmlTrash, 1);
});

test('public source package includes deployment and license while excluding nested private data', () => {
  const repo = path.join(root, 'source'); fs.mkdirSync(repo);
  for (const dir of ['src', 'scripts', 'tests', 'docs', 'public', 'desktop', '.github', 'deploy']) fs.mkdirSync(path.join(repo, dir));
  for (const file of ['LICENSE', 'package.json', '.env.example', '.gitattributes']) fs.writeFileSync(path.join(repo, file), 'public');
  fs.writeFileSync(path.join(repo, 'deploy/production.compose.yml'), 'public compose');
  fs.mkdirSync(path.join(repo, 'deploy/backups')); fs.writeFileSync(path.join(repo, 'deploy/backups/private.txt'), 'PRIVATE');
  fs.writeFileSync(path.join(repo, 'public/private.xml'), 'PRIVATE XML'); fs.writeFileSync(path.join(repo, 'desktop/.env.local'), 'SECRET');
  const zip = unzipSync(sourcePackage(repo, '1.1.0').bytes), names = Object.keys(zip);
  assert.ok(names.some(file => file.endsWith('/LICENSE'))); assert.ok(names.some(file => file.endsWith('/deploy/production.compose.yml')));
  assert.ok(names.some(file => file.endsWith('/.env.example'))); assert.ok(names.some(file => file.endsWith('/.gitattributes')));
  assert.doesNotMatch(names.join('\n'), /private|backups|\.env\.local/);
  assert.equal(Object.values(zip).some(bytes => Buffer.from(bytes).includes('PRIVATE')), false);
  fs.mkdirSync(path.join(repo, '.github/workflows'));
  fs.writeFileSync(path.join(repo, '.github/workflows/release.yml'), 'steps:\n  - run: node -e "console.log(\'ready: ok\')"\n');
  assert.throws(() => sourcePackage(repo, '1.1.0'), /工作流 YAML 语法错误/);
  fs.writeFileSync(path.join(repo, '.github/workflows/release.yml'), 'steps:\n  - run: |\n      node -e "console.log(\'ready: ok\')"\n');
  assert.ok(sourcePackage(repo, '1.1.0').paths.some(file => file.endsWith('/.github/workflows/release.yml')));
});

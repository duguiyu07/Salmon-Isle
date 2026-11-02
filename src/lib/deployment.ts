import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {XMLBuilder, XMLParser} from 'fast-xml-parser';
import {within} from './paths';

const options = {ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false};
const array = <T,>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = (value: any): string => String(value && typeof value === 'object' ? value['#text'] ?? '' : value ?? '');
const source = (channel: any) => text(channel['wp:base_site_url'] || channel.link).replace(/\/$/, '').toLowerCase();

function parse(xml: string) {
  if (Buffer.byteLength(xml) > 50 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML 过大或包含不允许的 DTD/实体声明');
  const document = new XMLParser(options).parse(xml), channel = document.rss?.channel;
  if (!channel || !text(channel['wp:wxr_version']).startsWith('1.')) throw new Error('请选择 WordPress WXR XML');
  return {document, channel};
}

/** Only taxonomy and theme definitions are borrowed; reference articles are never copied. */
export function deploymentWordPress(xml: string, referenceXml?: string) {
  const {document, channel} = parse(xml), originalItems = array<any>(channel.item);
  const posts = originalItems.filter(item => text(item['wp:post_type']) === 'post');
  if (!posts.length) throw new Error('XML 中没有博客文章');
  let borrowedCategories = 0, borrowedThemes = 0;
  if (referenceXml) {
    const reference = parse(referenceXml).channel;
    if (source(channel) !== source(reference)) throw new Error('参考 XML 与新 XML 的来源站点不同');
    const categories = array<any>(channel['wp:category']);
    for (const item of array<any>(reference['wp:category'])) {
      if (!categories.some(c => text(c['wp:category_nicename']) === text(item['wp:category_nicename']))) {
        categories.push(item); borrowedCategories++;
      }
    }
    channel['wp:category'] = categories;
    if (!originalItems.some(item => text(item['wp:post_type']) === 'wp_global_styles')) {
      const themes = array<any>(reference.item).filter(item => text(item['wp:post_type']) === 'wp_global_styles');
      channel.item = [...originalItems, ...themes]; borrowedThemes = themes.length;
    }
  }
  const known = new Set(array<any>(channel['wp:category']).map(c => text(c['wp:category_nicename'])));
  const unknown = new Set<string>();
  for (const post of posts) for (const term of array<any>(post.category)) {
    if (term['@_domain'] === 'category' && !known.has(text(term['@_nicename']))) unknown.add(text(term['@_nicename']));
  }
  if (unknown.size) throw new Error('缺少分类层级定义，请提供包含这些分类的参考 XML：' + [...unknown].join('、'));
  const counts: Record<string, number> = {};
  for (const item of posts) {const status = text(item['wp:status']); counts[status] = (counts[status] || 0) + 1;}
  return {
    xml: new XMLBuilder({ignoreAttributes: false}).build(document),
    summary: {site: source(channel), posts: posts.length, statuses: counts,
      passwordPosts: posts.filter(item => !!text(item['wp:post_password'])).length, borrowedCategories, borrowedThemes},
    posts: posts.map(item => ({sourceId: text(item['wp:post_id']), status: text(item['wp:status'])})),
    references: wordpressUploadReferences(channel, posts)
  };
}

export interface UploadReference {relative: string; articleIds: string[]}

export function legacyUploadPaths(body: string, site: string) {
  const hostname = new URL(site).hostname.replace(/^www\./, '');
  const paths = new Set<string>();
  for (const match of body.matchAll(/https?:\/\/[^\s<>"'()[\]{}\\]+\/wp-content\/uploads\/[^\s<>"'()[\]{}\\]+/g)) {
    const url = new URL(match[0].replaceAll('&amp;', '&'));
    if (url.hostname.replace(/^www\./, '') !== hostname) continue;
    const relative = decodeURIComponent(url.pathname.split('/wp-content/uploads/')[1] || '');
    if (relative) {within(path.resolve('.'), relative); paths.add(relative);}
  }
  return [...paths];
}

function wordpressUploadReferences(channel: any, posts: any[]) {
  const media = new Map(array<any>(channel.item).filter(i => text(i['wp:post_type']) === 'attachment')
    .map(item => [text(item['wp:post_id']), text(item['wp:attachment_url'])]));
  const references = new Map<string, Set<string>>();
  for (const item of posts) {
    const thumbnail = array<any>(item['wp:postmeta']).find(meta => text(meta['wp:meta_key']) === '_thumbnail_id');
    const body = text(item['content:encoded']) + '\n' + (thumbnail ? media.get(text(thumbnail['wp:meta_value'])) || '' : '');
    for (const relative of legacyUploadPaths(body, source(channel))) {
      if (!references.has(relative)) references.set(relative, new Set());
      references.get(relative)!.add(text(item['wp:post_id']));
    }
  }
  return [...references].sort(([a], [b]) => a.localeCompare(b)).map(([relative, ids]) => ({relative, articleIds: [...ids]}));
}

export function missingUploads(references: UploadReference[], mediaRoot: string) {
  return references.filter(reference => {
    const file = within(path.resolve(mediaRoot), reference.relative);
    return !fs.existsSync(file) || !fs.statSync(file).isFile();
  });
}

export function fileHash(file: string) {return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}

export function pageFingerprints(root: string) {
  const result: Record<string, string> = {};
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, {withFileTypes: true})) {
      if (item.isSymbolicLink()) throw new Error('部署数据不允许符号链接');
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (file.endsWith('.md') && /^kind:\s*page\s*$/m.test(fs.readFileSync(file, 'utf8').split(/\r?\n---(?:\r?\n|$)/)[0])) {
        result[path.relative(root, file).split(path.sep).join('/')] = fileHash(file);
      }
    }
  };
  walk(path.join(root, 'content'));
  return result;
}

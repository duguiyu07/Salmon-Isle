import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';
import { Article, ArticleMeta, Folder, SiteSettings, defaultSettings, AppError, Policy } from './model';
import { contentPath, dataDir, initDirs, relativePath, safeName, within } from './paths';
import { digest, hashPassword } from './crypto';
import { audit, indexDb } from './db';
import {libraryPath,assertLibraryWritable,isDesktop,withPublicLibrary} from './library-context';
import {normalizePageRoute} from './page-routes';
import postcss from 'postcss';

export function atomicWrite(file: string, text: string | Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, text, { mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
export function splitMarkdown(input: string): { meta: Partial<ArticleMeta>; body: string } {
  const match = input.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { meta: {}, body: input };
  const meta = YAML.parse(match[1], { maxAliasCount: 0 });
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new AppError('文章 frontmatter 必须是对象');
  return { meta, body: input.replace(/^\uFEFF/, '').slice(match[0].length) };
}
export function markdownFile(meta: ArticleMeta, body: string) {
  const content=meta.kind==='page'&&meta.contentFormat==='html'?body:`\n${body.trim()}\n`;
  return `---\n${YAML.stringify(meta, { lineWidth: 0 })}---\n${content}`;
}
export function normalizeMeta(meta: Partial<ArticleMeta>): ArticleMeta {
  const now = new Date().toISOString();
  if (meta.id && !/^[a-zA-Z0-9_-]{1,100}$/.test(meta.id)) throw new AppError('无效的文章 ID');
  return { id: meta.id || randomUUID(), title: String(meta.title || '无标题'), kind: meta.kind === 'page' ? 'page' : 'post',
    status: meta.status === 'published' ? 'published' : 'draft', createdAt: meta.createdAt || now, updatedAt: meta.updatedAt || now,
    summary: String(meta.summary || ''), pinned: !!meta.pinned, order: Number(meta.order) || 0,
    access: ['public', 'private', 'password'].includes(meta.access || '') ? meta.access! : 'inherit',
    aliases: Array.isArray(meta.aliases) ? meta.aliases.filter(a => typeof a === 'string' && a.startsWith('/') && !a.startsWith('//')) : [],
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    ...(meta.passwordHash ? { passwordHash: meta.passwordHash } : {}), ...(meta.cover ? { cover: meta.cover } : {}),
    ...(meta.giscusTerm ? { giscusTerm: meta.giscusTerm } : {}), ...(meta.source ? { source: meta.source } : {}),
    ...(meta.kind==='page'?{contentFormat:meta.contentFormat==='html'?'html' as const:'markdown' as const,...(meta.css!==undefined?{css:String(meta.css)}:{}),...(meta.route?{route:String(meta.route)}:{})}:{}),
    ...(meta.template === 'collection' ? { template: 'collection', collection: { folderId: String(meta.collection?.folderId || ''), perPage: Math.min(50, Math.max(1, Math.trunc(Number(meta.collection?.perPage) || 10))) } } : {})
  };
}
function walk(dir: string, fn: (full: string) => void) {
  if(!fs.existsSync(dir))return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) walk(full, fn);
    else if (entry.isFile()) fn(full);
  }
}
export function listFolders(): Folder[] {
  const root: Folder = { id: 'root', name: '所有文章', path: '', parentId: '', order: 0, access: 'public' };
  const folders: Folder[] = [root];
  walk(contentPath(), file => {
    if (path.basename(file) !== '.folder.yml') return;
    const raw = YAML.parse(fs.readFileSync(file, 'utf8'), { maxAliasCount: 0 }) || {};
    const folderPath = relativePath(path.dirname(file));
    folders.push({ ...raw, id: String(raw.id), name: String(raw.name || path.basename(path.dirname(file))), path: folderPath, parentId: '', order: Number(raw.order) || 0, access: raw.access || 'inherit' });
  });
  // Support ordinary externally-created directories without requiring generated metadata.
  function directories(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('.') && !e.isSymbolicLink()) {
      const file = path.join(dir, e.name); const p = relativePath(file);
      if (!folders.some(f => f.path === p)) folders.push({ id: `dir-${digest(p).slice(0,24)}`, name: e.name, path: p, parentId: '', order: 0, access: 'inherit' });
      directories(file);
    }
  }
  directories(contentPath());
  for (const folder of folders.slice(1)) {
    const parentPath = path.posix.dirname(folder.path);
    folder.parentId = folders.find(f => f.path === (parentPath === '.' ? '' : parentPath))?.id || 'root';
  }
  return folders.sort((a,b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'));
}
export function listArticles(): Article[] {
  const folders = listFolders(); const articles: Article[] = [];
  walk(contentPath(), file => {
    if (!file.endsWith('.md')) return;
    const raw = fs.readFileSync(file, 'utf8'); const { meta, body } = splitMarkdown(raw);
    const normalized = normalizeMeta({ ...meta, id: meta.id || `file-${digest(relativePath(file)).slice(0,24)}` });
    const p = relativePath(file); const dir = path.posix.dirname(p);
    if (articles.some(a => a.id === normalized.id)) throw new AppError(`重复文章 ID：${normalized.id}`);
    articles.push({ ...normalized, body, path: p, folderId: folders.find(f => f.path === (dir === '.' ? '' : dir))?.id || 'root', version: digest(raw) });
  });
  return articles.sort((a,b) => a.order-b.order || b.createdAt.localeCompare(a.createdAt));
}
export function findArticle(id: string) { return listArticles().find(a => a.id === id); }
export function articleMeta(article: Article): ArticleMeta {
  const { body: _body, path: _path, folderId: _folder, version: _version, ...meta } = article; return meta;
}
export function applyPolicy(input: Partial<Policy> & { password?: string }, existing: Policy): Policy {
  const access = input.access || existing.access;
  if (!['inherit','public','private','password'].includes(access)) throw new AppError('无效的访问权限');
  const passwordHash = input.password ? hashPassword(input.password) : existing.passwordHash;
  if (access === 'password' && !passwordHash) throw new AppError('请先设置访问密码');
  return { access, ...(access === 'password' ? { passwordHash } : {}) };
}
export function saveArticle(input: Partial<ArticleMeta> & { body: string; folderId?: string; version?: string; password?: string; filename?: string }, options:{create?:boolean;policy?:Policy}={}) {
  assertLibraryWritable();
  const existing = input.id ? findArticle(input.id) : undefined;
  if (existing && input.version !== existing.version) throw new AppError('文章已被另一个窗口修改，请重新载入后保存。', 409);
  if (input.id && !existing && !options.create) throw new AppError('文章不存在', 404);
  if (!input.title?.trim()) throw new AppError('请输入文章标题');
  if (input.body.length > 10 * 1024 * 1024) throw new AppError('文章过大');
  const folder = listFolders().find(f => f.id === (input.folderId || existing?.folderId || 'root'));
  if (!folder) throw new AppError('目标文件夹不存在');
  const policy = options.policy || applyPolicy(input, existing || { access: 'inherit' });
  const meta = normalizeMeta({ ...(existing ? articleMeta(existing) : {}), ...input, ...policy, passwordHash: policy.passwordHash, updatedAt: new Date().toISOString() });
  if(meta.kind==='page'&&meta.contentFormat==='html'){
    if(meta.status==='published')try{postcss.parse(meta.css||'');}catch{throw new AppError('CSS 语法有误，请修正后发布');}
    if(meta.route){const route=normalizePageRoute(meta.route);if(!route)throw new AppError('页面地址无效或与系统地址冲突');meta.route=route;if(listArticles().some(a=>a.id!==meta.id&&a.kind==='page'&&(a.route===route||a.aliases.includes(route))))throw new AppError('已有页面使用这个地址');}
    else if(meta.status==='published')throw new AppError('发布前请填写页面地址');
  }
  const target = contentPath(path.posix.join(folder.path, `${safeName(input.filename || meta.title)}--${meta.id}.md`));
  if (existing) atomicWrite(path.join(dataDir(), 'history', meta.id, `${Date.now()}-${randomUUID()}.md`), markdownFile(articleMeta(existing), existing.body));
  atomicWrite(target, markdownFile(meta, input.body));
  if (existing && contentPath(existing.path) !== target) fs.unlinkSync(contentPath(existing.path));
  indexArticle(meta.id, meta.title, input.body, relativePath(target)); audit(existing ? 'article.update' : 'article.create', meta.id);
  return findArticle(meta.id)!;
}
export function writeImportedArticle(meta: ArticleMeta, body: string, folderId: string, replace = false) {
  assertLibraryWritable();
  const existing = findArticle(meta.id);
  if (existing && !replace) return existing;
  const folder = listFolders().find(f => f.id === folderId); if (!folder) throw new AppError('目标文件夹不存在');
  if (existing) atomicWrite(path.join(dataDir(), 'history', meta.id, `${Date.now()}-${randomUUID()}.md`), markdownFile(articleMeta(existing), existing.body));
  const target = contentPath(path.posix.join(folder.path, `${safeName(meta.title)}--${meta.id}.md`));
  atomicWrite(target, markdownFile(meta, body));
  if (existing && contentPath(existing.path) !== target) fs.unlinkSync(contentPath(existing.path));
  indexArticle(meta.id, meta.title, body, relativePath(target)); return findArticle(meta.id)!;
}
function indexArticle(id: string, title: string, body: string, p: string) { indexDb().prepare('INSERT OR REPLACE INTO articles VALUES(?,?,?,?)').run(id,title,body,p); }
export function reindex() {
  const articles = listArticles(); indexDb().exec('DELETE FROM articles');
  for (const a of articles) indexArticle(a.id,a.title,a.body,a.path); return articles.length;
}
export function searchIndex(query:string){
  if(!(indexDb().prepare('SELECT COUNT(*) AS count FROM articles').get() as {count:number}).count&&listArticles().length)reindex();
  const q=query.trim().toLowerCase().slice(0,200);
  return new Set((indexDb().prepare('SELECT id FROM articles WHERE instr(lower(title),?)>0 OR instr(lower(body),?)>0').all(q,q) as {id:string}[]).map(r=>r.id));
}
export function saveFolder(input: Partial<Folder> & { password?: string }) {
  assertLibraryWritable();
  const folders = listFolders(); const current = folders.find(f => f.id === input.id);
  if (input.id === 'root') throw new AppError('根目录不能修改');
  if (input.id && !current) throw new AppError('文件夹不存在', 404);
  const parent = folders.find(f => f.id === (input.parentId || current?.parentId || 'root'));
  if (!parent) throw new AppError('上级文件夹不存在');
  if (!input.name?.trim()) throw new AppError('请输入文件夹名称');
  if (current && (parent.id === current.id || parent.path.startsWith(current.path + '/'))) throw new AppError('不能移入自身或子文件夹');
  const target = contentPath(path.posix.join(parent.path, safeName(input.name)));
  const oldPath = current ? contentPath(current.path) : null;
  if (target !== oldPath && fs.existsSync(target)) throw new AppError('已存在同名文件夹');
  const folder = { id: current?.id || randomUUID(), name: input.name.trim(), order: Number(input.order ?? current?.order) || 0, ...(input.aliases||current?.aliases?{aliases:input.aliases||current?.aliases}:{}), ...applyPolicy(input, current || { access: 'inherit' }) };
  if (oldPath && oldPath !== target) fs.renameSync(oldPath,target);
  atomicWrite(path.join(target, '.folder.yml'), YAML.stringify(folder)); reindex(); audit(current ? 'folder.update' : 'folder.create',folder.id);
  return listFolders().find(f => f.id === folder.id)!;
}
export function listTrash() {
  initDirs(); if(!fs.existsSync(libraryPath('trash')))return [];
  return fs.readdirSync(libraryPath('trash'), { withFileTypes: true }).filter(e => e.isDirectory()).flatMap(e => {
    const manifest = libraryPath('trash', e.name, 'manifest.json');
    return fs.existsSync(manifest) ? [JSON.parse(fs.readFileSync(manifest,'utf8')) as { id: string; kind: string; title: string; originalPath: string; time: string }] : [];
  });
}
export function trashedArticleIds(){
  initDirs();const ids=new Set<string>();
  const read=(file:string)=>{if(file.endsWith('.md')||path.basename(file)==='content'){try{const {meta}=splitMarkdown(fs.readFileSync(file,'utf8'));if(meta.id)ids.add(meta.id);}catch{}}};
  for(const entry of fs.readdirSync(libraryPath('trash'),{withFileTypes:true}))if(entry.isDirectory()){
    const content=libraryPath('trash',entry.name,'content');if(!fs.existsSync(content))continue;if(fs.statSync(content).isDirectory())walk(content,read);else read(content);
  }return ids;
}
export function trashItem(id: string, kind: 'article' | 'folder') {
  assertLibraryWritable();
  const item = kind === 'article' ? findArticle(id) : listFolders().find(f => f.id === id && id !== 'root');
  if (!item) throw new AppError('内容不存在',404);
  const trashId = randomUUID(); const dir = libraryPath('trash',trashId); fs.mkdirSync(dir);
  const manifest = { id: trashId, kind, title: 'title' in item ? item.title : item.name, originalPath: item.path, time: new Date().toISOString() };
  fs.renameSync(contentPath(item.path),path.join(dir,'content'));
  atomicWrite(path.join(dir,'manifest.json'),JSON.stringify(manifest)); reindex(); audit('trash',id); return manifest;
}
export function restoreItem(id: string) {
  assertLibraryWritable();
  const item = listTrash().find(t => t.id === id); if (!item) throw new AppError('回收站记录不存在',404);
  const dir = within(libraryPath('trash'),id);
  if(item.kind==='media'){
    const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
    const target=within(libraryPath('media'),manifest.media.id);
    if(fs.existsSync(target))throw new AppError('同一媒体已经存在');
    fs.renameSync(path.join(dir,'content'),target);atomicWrite(libraryPath('media-meta',manifest.media.id+'.json'),JSON.stringify(manifest.media,null,2)+'\n');
    fs.unlinkSync(path.join(dir,'manifest.json'));fs.rmdirSync(dir);audit('media.restore',manifest.media.id);return;
  }
  const target = contentPath(item.originalPath); if (fs.existsSync(target)) throw new AppError('原位置已有内容，请先移动同名内容');
  fs.mkdirSync(path.dirname(target),{ recursive: true });
  fs.renameSync(path.join(dir,'content'), target);
  fs.unlinkSync(path.join(dir,'manifest.json')); fs.rmdirSync(dir); reindex(); audit('restore',id);
}
export function getSettings(): SiteSettings {
  initDirs(); const file = path.join(dataDir(),'site.yml');
  if (!fs.existsSync(file)) return structuredClone(defaultSettings);
  const input = YAML.parse(fs.readFileSync(file,'utf8'),{ maxAliasCount: 0 });
  return { ...defaultSettings,...input,giscus:{...defaultSettings.giscus,...input.giscus} };
}
export function saveSettings(input: SiteSettings) {
  if(isDesktop())throw new AppError('网站设置请在在线后台修改',403);
  if (!input.title?.trim()) throw new AppError('站点名称不能为空');
  if (!Array.isArray(input.navigation) || input.navigation.some(n => !/^\/(?!\/)/.test(n.href))) throw new AppError('导航地址必须是站内路径');
  if (input.logo && !/^(\/(?!\/)|https:\/\/)/.test(input.logo)) throw new AppError('无效的 Logo 地址');
  if (input.giscus.repo && !/^[\w.-]+\/[\w.-]+$/.test(input.giscus.repo)) throw new AppError('无效的 Giscus 仓库');
  const publicFolders=withPublicLibrary(()=>listFolders());
  if (input.knowledgeRootId && !publicFolders.some(f => f.id === input.knowledgeRootId && f.id !== 'root')) throw new AppError('前台目录根文件夹不存在，请先提交并同步文件夹');
  if(input.homeFolders.some(id=>!publicFolders.some(folder=>folder.id===id)))throw new AppError('首页引用的文件夹尚未同步');
  atomicWrite(path.join(dataDir(),'site.yml'),YAML.stringify(input)); audit('settings.update','site'); return getSettings();
}

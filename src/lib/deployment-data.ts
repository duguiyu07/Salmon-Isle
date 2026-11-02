import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {backupData, restoreData} from './backup';
import {closeDatabases} from './db';
import {analyzeWordPress, commitImport} from './wordpress';
import {listArticles, listTrash, restoreItem, splitMarkdown, trashedArticleIds, trashItem} from './storage';
import {getMedia} from './media';
import {deploymentWordPress, fileHash, legacyUploadPaths, missingUploads, pageFingerprints} from './deployment';
import {createTarGzip} from './tar-archive';

export interface DeploymentDataOptions {
  sourceDir: string; xmlFile: string; mediaRoot: string; referenceXml?: string; outputDir: string;
}

export function prepareDeploymentData(input: DeploymentDataOptions) {
  const sourceDir = path.resolve(input.sourceDir), output = path.resolve(input.outputDir);
  if (!fs.existsSync(path.join(sourceDir, 'content'))) throw new Error('源数据目录缺少 content');
  if (output === sourceDir || output.startsWith(sourceDir + path.sep) || sourceDir.startsWith(output + path.sep)) throw new Error('输出目录和源数据目录必须独立');
  if (fs.existsSync(path.join(sourceDir, 'library-connection.json')) || process.env.SALMON_CONTENT_REPO_DIR) throw new Error('请先导出 Git 内容库；此准备命令用于独立 data 目录');
  const prepared = deploymentWordPress(fs.readFileSync(input.xmlFile, 'utf8'), input.referenceXml ? fs.readFileSync(input.referenceXml, 'utf8') : undefined);
  const missing = missingUploads(prepared.references, input.mediaRoot);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const privateDir = path.join(output, 'private'), run = path.join(privateDir, 'runs', stamp), staging = path.join(run, 'staging');
  fs.mkdirSync(run, {recursive: true, mode: 0o700});
  const reportFile = path.join(privateDir, 'migration-report.json');
  const report: Record<string, any> = {
    time: new Date().toISOString(), ready: false, archive: null, source: prepared.summary,
    referencedUploadFiles: prepared.references.length, missingUploads: missing,
    privateBackup: path.join(run, 'before-import.zip'), staging, errors: [] as string[]
  };
  const previousDataDir = process.env.SALMON_DATA_DIR;
  function saveReport() {
    const body = JSON.stringify(report, null, 2) + '\n';
    fs.writeFileSync(path.join(run, 'migration-report.json'), body, {mode: 0o600});
    fs.writeFileSync(reportFile, body, {mode: 0o600});
    fs.writeFileSync(path.join(privateDir, 'missing-media.txt'), missing.length ?
      ['以下路径相对于 wp-content/uploads；请保留文件名和年份目录。', ...missing.map(item => `${item.relative}\tWordPress IDs: ${item.articleIds.join(', ')}`)].join('\n') + '\n' : '正文和封面引用的 uploads 文件已齐全。\n', {mode: 0o600});
  }
  try {
    closeDatabases(); process.env.SALMON_DATA_DIR = sourceDir;
    const pagesBefore = pageFingerprints(sourceDir), originalPages = listArticles().filter(article => article.kind === 'page');
    const routes = originalPages.map(page => page.route || '').sort();
    if (!isDeepStrictEqual(routes, ['/', '/about', '/knowledge', '/links', '/misc'].sort())) throw new Error('源数据必须保留约定的五个页面及地址');
    fs.writeFileSync(report.privateBackup, backupData(), {mode: 0o600});
    closeDatabases();
    restoreData(fs.readFileSync(report.privateBackup), staging);
    process.env.SALMON_DATA_DIR = staging;
    let analysis = analyzeWordPress(prepared.xml);
    // The new WXR is authoritative, including items previously in the local trash.
    for (const candidate of analysis.candidates.filter(item => item.meta.kind === 'post' && item.inTrash)) {
      const entry = listTrash().find(item => {
        const file = path.join(staging, 'trash', item.id, 'content');
        return item.kind === 'article' && fs.existsSync(file) && fs.statSync(file).isFile() &&
          splitMarkdown(fs.readFileSync(file, 'utf8')).meta.id === candidate.meta.id;
      });
      if (entry) restoreItem(entry.id);
    }
    analysis = analyzeWordPress(prepared.xml);
    const candidates = analysis.candidates.filter(candidate => candidate.meta.kind === 'post');
    const expectedIds = new Set(candidates.map(candidate => candidate.meta.id));
    const extra = listArticles().filter(article => article.kind === 'post' && !expectedIds.has(article.id));
    for (const article of extra) trashItem(article.id, 'article');
    report.removedFromActive = extra.map(article => ({id: article.id, title: article.title}));
    const imported = commitImport(analysis, candidates.map(candidate => ({id: candidate.meta.id,
      selected: true, update: true, folder: candidate.folder})), {mediaRoot: path.resolve(input.mediaRoot)});
    // The importer can skip an identical draft before applying its trash state.
    // Apply the WXR lifecycle separately so restoring for an update never exposes it.
    for (const candidate of candidates.filter(item => item.trash)) {
      if (listArticles().some(article => article.id === candidate.meta.id)) {
        trashItem(candidate.meta.id, 'article'); imported.trashed++;
      }
    }
    report.import = imported;
    report.conversionWarnings = analysis.warnings;
    const current = listArticles(), posts = current.filter(article => article.kind === 'post');
    const expectedActive = candidates.filter(candidate => !candidate.trash);
    report.pages = {unchanged: isDeepStrictEqual(pagesBefore, pageFingerprints(staging)),
      files: pagesBefore, routes: originalPages.map(page => ({id: page.id, route: page.route, title: page.title}))};
    report.articles = {active: posts.length, published: posts.filter(article => article.status === 'published').length,
      draft: posts.filter(article => article.status === 'draft').length, password: posts.filter(article => article.access === 'password').length,
      xmlTrash: candidates.filter(candidate => candidate.trash).length};
    if (!report.pages.unchanged) report.errors.push('独立页面文件发生变化');
    if (posts.length !== expectedActive.length) report.errors.push('活动文章数量与 XML 不一致');
    const trashIds = trashedArticleIds();
    if (candidates.some(candidate => candidate.trash && !trashIds.has(candidate.meta.id))) report.errors.push('XML 回收站文章未正确归档');
    for (const candidate of expectedActive) {
      const article = posts.find(article => article.id === candidate.meta.id);
      if (!article || ['status', 'access', 'createdAt', 'updatedAt'].some(key =>
        article[key as keyof typeof article] !== candidate.meta[key as keyof typeof candidate.meta])) report.errors.push('文章状态、权限或日期不一致：' + candidate.meta.id);
    }
    const remainingLegacy: {articleId: string; paths: string[]}[] = [];
    const missingLocal: {articleId: string; mediaId: string}[] = [];
    for (const article of current) {
      const body = article.body + '\n' + (article.cover || '') + '\n' + (article.css || '');
      const paths = legacyUploadPaths(body, prepared.summary.site);
      if (paths.length) remainingLegacy.push({articleId: article.id, paths});
      for (const match of body.matchAll(/\/api\/media\/([a-zA-Z0-9_-]{1,100})/g)) {
        if (!getMedia(match[1]) || !fs.existsSync(path.join(staging, 'media', match[1]))) missingLocal.push({articleId: article.id, mediaId: match[1]});
      }
    }
    report.remainingLegacyUploads = remainingLegacy;
    report.missingLocalMedia = missingLocal;
    if (missing.length) report.errors.push(`uploads 缺少 ${missing.length} 个被引用文件`);
    if (remainingLegacy.length) report.errors.push('转换后仍有文章引用旧站 uploads');
    if (missingLocal.length) report.errors.push('站点正文引用了不存在的本地附件');
    if (imported.warnings.length) report.errors.push('媒体导入存在未解决的警告');
    if (!fs.existsSync(path.join(staging, 'admin.json'))) report.errors.push('缺少管理员配置，请先在本地初始化管理员');
    if (!report.errors.length) {
      const snapshot = backupData(); closeDatabases();
      const exported = path.join(run, 'export'); restoreData(snapshot, path.join(exported, 'data'));
      const archive = path.join(privateDir, `Salmon-Isle-Data-${stamp}.tar.gz`);
      createTarGzip(archive, exported, ['data']);
      report.archive = archive; report.sha256 = fileHash(archive); report.ready = true;
      fs.writeFileSync(path.join(privateDir, 'SHA256SUMS.txt'), `${report.sha256}  ${path.basename(archive)}\n`, {mode: 0o600});
    }
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    closeDatabases();
    if (previousDataDir === undefined) delete process.env.SALMON_DATA_DIR; else process.env.SALMON_DATA_DIR = previousDataDir;
    saveReport();
  }
  return {report, reportFile};
}

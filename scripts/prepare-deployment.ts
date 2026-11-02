import path from 'node:path';
import {prepareDeploymentData} from '../src/lib/deployment-data';

const args = process.argv.slice(2);
const value = (flag: string) => {const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined;};
if (args.includes('--help') || !value('--xml')) {
  console.log('npm run prepare:deployment -- --xml <新WXR.xml> --media-dir <完整uploads目录> --reference-xml <含分类和主题的旧WXR.xml> [--data-dir <现有data>] [--output <dist/deployment>]');
  process.exit(args.includes('--help') ? 0 : 1);
}
try {
  const {report, reportFile} = prepareDeploymentData({sourceDir: value('--data-dir') || process.env.SALMON_DATA_DIR || 'data',
    xmlFile: value('--xml')!, mediaRoot: value('--media-dir') || 'deploy-input/uploads', referenceXml: value('--reference-xml'),
    outputDir: value('--output') || 'dist/deployment'});
  console.log(JSON.stringify({ready: report.ready, articles: report.articles, pagesUnchanged: report.pages?.unchanged,
    missingUploads: report.missingUploads.length, archive: report.archive, report: path.resolve(reportFile)}, null, 2));
  if (!report.ready) {console.error('尚未生成最终数据包。请查看私有迁移报告，补齐资源或解决错误后重试。'); process.exitCode = 2;}
} catch (error) {console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;}

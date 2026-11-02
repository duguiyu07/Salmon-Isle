import {notFound} from 'next/navigation';
import {getViewer} from '@/lib/auth';
import {withWorkspace} from '@/lib/library-context';
import {mediaReferenceDocument} from '@/lib/media-references';
import {renderMarkdown} from '@/lib/markdown';
import {renderHtmlPage} from '@/lib/html-pages';
import {workspacePreviewUrls} from '@/lib/workspace-media-url';
import {MarkdownBody} from '@/components/reader';
export const dynamic='force-dynamic';
export const metadata={title:'媒体引用预览',robots:{index:false,follow:false}};
export default async function ReferencePreview({params}:{params:Promise<{key:string}>}){
  const viewer=await getViewer();if(!viewer.admin)notFound();const {key}=await params;
  return withWorkspace(async()=>{
    const source=mediaReferenceDocument(key);if(!source)notFound();const {article,field,kind}=source;
    const rendered=article.kind==='page'&&article.contentFormat==='html'?await renderHtmlPage(article,viewer):{...await renderMarkdown(article.body),css:'',className:''};
    return <main id="main" className={'reading-width managed-page '+rendered.className} data-page-id={article.id}>
      <p className="status-badge">{kind==='trash'?'回收站预览':kind==='draft'?'编辑稿预览':'工作区预览'} · {field} · 仅管理员可见</p>
      <h1>{article.title}</h1>{field.includes('封面')&&article.cover&&<img src={workspacePreviewUrls(article.cover)} alt="封面"/>}
      <style>{workspacePreviewUrls(rendered.css)}</style><MarkdownBody html={workspacePreviewUrls(rendered.html)}/>
    </main>;
  });
}

import {notFound} from 'next/navigation';
import {getViewer} from '@/lib/auth';
import {withWorkspace} from '@/lib/library-context';
import {findArticle} from '@/lib/storage';
import {readEditorDraft} from '@/lib/editor-drafts';
import {workspacePreviewUrls} from '@/lib/workspace-media-url';
import {renderMarkdown} from '@/lib/markdown';
import {renderHtmlPage} from '@/lib/html-pages';
import {MarkdownBody} from '@/components/reader';
export const dynamic='force-dynamic';
export const metadata={title:'工作区预览',robots:{index:false,follow:false}};
export default async function WorkspacePreview({params}:{params:Promise<{id:string}>}){
  const viewer=await getViewer();if(!viewer.admin)notFound();const {id}=await params;
  return withWorkspace(async()=>{
    const stored=findArticle(id);if(!stored)notFound();const article={...stored,...readEditorDraft(id)?.document};
    const rendered=article.kind==='page'&&article.contentFormat==='html'?await renderHtmlPage(article,viewer):{...await renderMarkdown(article.body),css:'',className:''};
    return <main id="main" className={'reading-width managed-page '+rendered.className} data-page-id={id}><p className="status-badge">工作区预览 · 尚未提交的内容仅管理员可见</p><h1>{article.title}</h1><style>{workspacePreviewUrls(rendered.css)}</style><MarkdownBody html={workspacePreviewUrls(rendered.html)}/></main>;
  });
}

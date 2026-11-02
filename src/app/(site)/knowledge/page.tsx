import Link from 'next/link';
import { PublicFolderNav } from '@/components/folder-tree';
import { CompactArticle } from '@/components/compact-article';
import { getViewer } from '@/lib/auth';
import { knowledgeData, descendantIds } from '@/lib/public-data';
import { archiveHref, paginate } from '@/lib/pagination';
import { FolderOpen } from 'lucide-react';
import {listArticles} from '@/lib/storage';
import {ManagedPage} from '@/components/managed-page';
import {articleForEditorViewer} from '@/lib/editor-drafts';

export const metadata={title:'Index'};
export default async function Knowledge({searchParams}:{searchParams:Promise<{folder?:string;q?:string;sort?:string;page?:string}>}){
  const params=await searchParams;
  const viewer=await getViewer(),managed=listArticles().find(a=>a.kind==='page'&&a.contentFormat==='html'&&a.route==='/knowledge');
  if(managed)return <ManagedPage page={articleForEditorViewer(managed,viewer.admin)} viewer={viewer} query={params}/>;
  const data=knowledgeData(viewer);
  const selected=data.folders.find(f=>f.id===params.folder)||data.folders.find(f=>f.id==='root')!;
  const ids=descendantIds(data.folders,selected.id);
  const q=(params.q||'').trim().toLowerCase();
  let articles=data.articles.filter(a=>(selected.id==='root'||ids.has(a.folderId))&&(!q||a.title.toLowerCase().includes(q)));
  if(params.sort==='title')articles=articles.toSorted((a,b)=>a.title.localeCompare(b.title,'zh-CN',{numeric:true}));
  else if(params.sort!=='order')articles=articles.toSorted((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
  const page=paginate(articles,params.page,15);
  const filters={folder:selected.id,q:params.q,sort:params.sort};
  return <main id="main" className="knowledge-page">
    <header className="knowledge-heading reading-width"><h1 className="page-title">Index</h1>
      <p className="muted index-intro">*可在此查看网站的所有内容。归类为杂项/其他的文章除外，这类文章位于 MISC 页面。</p>
      <nav className="index-shortcuts" aria-label="其他归档"><Link className="shortcut-card" href="/misc"><strong>MISC</strong><span>杂谈 / 日常类文章归档</span></Link><Link className="shortcut-card" href="/links"><strong>Links</strong><span>相关网站 / 友情链接归档</span></Link></nav>
    </header>
    <div className="knowledge-layout reading-width"><PublicFolderNav folders={data.folders} current={selected.id}/>
      <section className="knowledge-content" aria-label={selected.name}><div className="compact-list">{page.items.map(a=><CompactArticle key={a.id} article={a}/>)}
      {!articles.length&&<div className="empty-state"><FolderOpen size={30}/><h3>{q?'没有找到相关文章':'暂无已发布文章'}</h3>{q&&<p>试试其他关键词。</p>}</div>}</div>
      {page.pages>1&&<nav className="pagination" aria-label="分页">{page.current>1&&<Link href={archiveHref(page.current-1,filters)}>← 上一页</Link>}<span>{page.current} / {page.pages}</span>{page.current<page.pages&&<Link href={archiveHref(page.current+1,filters)}>下一页 →</Link>}</nav>}
      </section>
    </div>
  </main>;
}

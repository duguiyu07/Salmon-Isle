import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { redirect,notFound } from 'next/navigation';
import { ArticleCard } from '@/components/article-card';
import { getSettings,listArticles,listFolders } from '@/lib/storage';
import { getViewer } from '@/lib/auth';
import { publicArticle,visibility } from '@/lib/access';
import {ManagedPage} from '@/components/managed-page';
import {articleForEditorViewer} from '@/lib/editor-drafts';
export default async function Home({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const query=await searchParams;const viewer=await getViewer();if(query.p||query.page_id){const article=listArticles().find(a=>a.source?.id===(query.p||query.page_id));if(article&&(viewer.admin||!visibility(article).hidden))redirect(`/posts/${article.id}`);notFound();}
  const managed=listArticles().find(a=>a.kind==='page'&&a.contentFormat==='html'&&a.route==='/');
  if(managed)return <ManagedPage page={articleForEditorViewer(managed,viewer.admin)} viewer={viewer} query={query}/>;
  const settings=getSettings();const folders=listFolders();
  const descendants=(id:string):boolean=>{if(!settings.homeFolders.length)return true;let f=folders.find(f=>f.id===id);const seen=new Set<string>();while(f&&!seen.has(f.id)){seen.add(f.id);if(settings.homeFolders.includes(f.id))return true;f=folders.find(p=>p.id===f?.parentId);}return false;};
  const articles=listArticles().filter(a=>a.kind==='post'&&a.status==='published'&&descendants(a.folderId)).map(a=>publicArticle(a,viewer,folders)).filter(a=>a!==null);const pinned=articles.filter(a=>a.pinned);const recent=articles.filter(a=>!a.pinned);const page=Math.max(1,Number(query.page)||1);const perPage=8;
  return <main id="main" className="home-page reading-width">{pinned.length>0&&<section className="home-section"><div className="section-label"><h2>置顶文章</h2></div><div className="article-list">{pinned.map(a=><ArticleCard key={a.id} article={a}/>)}</div></section>}<section className="home-section"><div className="section-label"><h2>最近文章</h2><Link href="/knowledge">全部文章 <ArrowUpRight size={14}/></Link></div><div className="article-list">{recent.slice((page-1)*perPage,page*perPage).map(a=><ArticleCard key={a.id} article={a}/>)}</div>{!articles.length&&<div className="empty-state"><h2>暂无已发布文章</h2><Link className="outline-link" href="/admin">写下第一篇文章 <ArrowUpRight size={15}/></Link></div>}{recent.length>perPage&&<nav className="pagination" aria-label="分页">{page>1&&<Link href={`/?page=${page-1}`}>← 上一页</Link>}<span>{page} / {Math.ceil(recent.length/perPage)}</span>{page*perPage<recent.length&&<Link href={`/?page=${page+1}`}>下一页 →</Link>}</nav>}</section></main>;
}

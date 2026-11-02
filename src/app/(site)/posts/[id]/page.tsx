import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CalendarDays, FolderClosed, ArrowLeft, ArrowRight } from 'lucide-react';
import { findArticle, listArticles, listFolders, getSettings } from '@/lib/storage';
import { getViewer } from '@/lib/auth';
import { canRead, visibility } from '@/lib/access';
import { renderMarkdown } from '@/lib/markdown';
import { folderArticles } from '@/lib/public-data';
import { MarkdownBody, ReaderLayout, UnlockForm, Giscus } from '@/components/reader';
import { SiteHeader, SiteFooter } from '@/components/site-chrome';
import { dateText } from '@/components/article-card';
import { CollectionList } from '@/components/collection-list';
import {ManagedPage} from '@/components/managed-page';
import {articleForEditorViewer} from '@/lib/editor-drafts';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{page?:string}> };

export async function generateMetadata({ params }: Props) {
  const article = findArticle((await params).id);
  const viewer = await getViewer();
  if (!article || (!viewer.admin && visibility(article).hidden)) return { title: '文章不存在' };
  const restricted = visibility(article).restricted;
  return {
    title: article.title,
    description: restricted ? '受密码保护的文章' : article.summary,
    robots: restricted ? { index: false, follow: false } : undefined,
  };
}

export default async function ArticlePage({ params,searchParams }: Props) {
  const stored = findArticle((await params).id);
  const viewer = await getViewer();
  const article=stored?articleForEditorViewer(stored,viewer.admin):undefined;
  if (!article || (!viewer.admin && visibility(article).hidden)) notFound();
  const rule = visibility(article);
  const readable = canRead(article, viewer);
  if(readable&&article.kind==='page'&&article.contentFormat==='html'){
    const query=await searchParams;
    if(article.status==='published'&&article.route)redirect(article.route+(query.page?'?page='+encodeURIComponent(query.page):''));
    const settings=getSettings();return <><SiteHeader settings={settings}/><ManagedPage page={article} viewer={viewer} query={query}/><SiteFooter settings={settings}/></>;
  }
  if(readable && article.kind==='page' && article.aliases.some(alias=>['/index','/index-zh','/knowledge-base'].includes(alias)))redirect('/knowledge');
  const { html, headings } = readable ? await renderMarkdown(article.body,{pageTitle:article.kind==='page'}) : { html: '', headings: [] };
  const folders = listFolders();
  const folder = folders.find(f => f.id === article.folderId);
  const settings = getSettings();
  const gate = rule.gates.find(g => !viewer.grants.has(g.fingerprint));
  const commentTerm = !rule.restricted && settings.giscus.enabled && settings.giscus.repo
    ? article.giscusTerm || `salmon:${article.id}` : undefined;
  const locked = gate ? <UnlockForm articleId={article.id} gateId={gate.id} name={gate.name} /> : null;
  const draftBadge = article.status === 'draft'
    ? <span className="status-badge">草稿 · 仅管理员可见</span> : null;

  if (article.kind === 'page') {
    const containsTitle = headings.some(h => h.depth === 1);
    return <>
      <SiteHeader settings={settings} />
      <main id="main" className={`reading-width standalone-page${article.aliases.includes('/links')?' links-page':''}`}>
        {draftBadge}
        {!containsTitle && <header className="article-header"><h1 className="page-title">{article.title}</h1></header>}
        {readable ? <>
          {article.cover && <img className="article-cover" src={article.cover} alt="" />}
          <MarkdownBody html={html} />
          {article.template==='collection'&&article.collection&&<CollectionList folderId={article.collection.folderId} perPage={article.collection.perPage} page={Math.trunc(Number((await searchParams).page))||1} articleId={article.id} viewer={viewer}/>}
          {commentTerm && article.aliases.some(alias=>['/misc','/links'].includes(alias)) && <Giscus config={settings.giscus} term={commentTerm} />}
        </> : locked}
      </main>
      <SiteFooter settings={settings} />
    </>;
  }

  const siblings = listArticles().filter(a => a.kind === 'post' && a.status === 'published' && !visibility(a).hidden);
  const index = siblings.findIndex(a => a.id === article.id);
  const previous = siblings[index + 1];
  const next = index > 0 ? siblings[index - 1] : undefined;
  return <ReaderLayout headings={headings} categoryName={folder?.name||'同类文章'} articles={folderArticles(article.folderId,viewer)} currentArticleId={article.id} settings={settings} commentTerm={commentTerm}>
    <main id="main" className="article-page reading-width">
      <div className="breadcrumbs">
        <Link href="/">首页</Link><span>/</span>
        <Link href={`/knowledge?folder=${article.folderId}`}>{folder?.name || '文章'}</Link><span>/</span><span>正文</span>
      </div>
      <header className="article-header">
        {draftBadge}<h1>{article.title}</h1>
        <div className="article-meta">
          <span><CalendarDays size={14} /><time dateTime={article.createdAt}>{dateText(article.createdAt)}</time></span>
          <Link href={`/knowledge?folder=${article.folderId}`}><FolderClosed size={14} />{folder?.name}</Link>
        </div>
      </header>
      {readable ? <>
        {article.cover && <img className="article-cover" src={article.cover} alt="" />}
        <MarkdownBody html={html} />
        {article.tags.length > 0 && <div className="article-tags"><span>Tags:</span>{article.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
        
        <nav className="article-neighbors">
          {previous ? <Link href={`/posts/${previous.id}`}><small><ArrowLeft size={13} />上一篇</small><span>{previous.title}</span></Link> : <span />}
          {next && <Link href={`/posts/${next.id}`}><small>下一篇<ArrowRight size={13} /></small><span>{next.title}</span></Link>}
        </nav>
      </> : locked}
    </main>
  </ReaderLayout>;
}

import Link from 'next/link';
import { ArticleCard } from './article-card';
import { descendantIds, publicData } from '@/lib/public-data';
import { listFolders } from '@/lib/storage';
import { Viewer } from '@/lib/model';
import { paginate } from '@/lib/pagination';

export function CollectionList({folderId,perPage,page,articleId,viewer}:{folderId:string;perPage:number;page:number;articleId:string;viewer:Viewer}) {
  const ids=descendantIds(listFolders(),folderId);
  const articles=publicData(viewer).articles.filter(a=>ids.has(a.folderId)).toSorted((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const {items,pages,current}=paginate(articles,page,perPage);
  return <section className="collection-list" aria-label="文章列表">
    <div className="article-list">{items.map(a=><ArticleCard key={a.id} article={a}/>)}</div>
    {!articles.length&&<p className="muted empty-state">暂无已发布文章。</p>}
    {pages>1&&<nav className="pagination" aria-label="分页">{current>1&&<Link href={`/posts/${articleId}?page=${current-1}`}>← 上一页</Link>}<span>{current} / {pages}</span>{current<pages&&<Link href={`/posts/${articleId}?page=${current+1}`}>下一页 →</Link>}</nav>}
  </section>;
}

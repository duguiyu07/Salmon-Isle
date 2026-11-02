import Link from 'next/link';
import { LockKeyhole,Pin } from 'lucide-react';
import { PublicArticle } from '@/lib/model';
export function dateText(value:string){const d=new Date(value);return Number.isNaN(d.valueOf())?'未设置日期':d.toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Hong_Kong'}).replaceAll('/','.');}
export function ArticleCard({article:a}:{article:PublicArticle}){return <article className={`article-card${a.cover?' with-cover':''}`}>
  {a.cover&&<Link href={`/posts/${a.id}`} className="card-cover" tabIndex={-1} aria-hidden="true"><img src={a.cover} alt="" loading="lazy"/></Link>}
  <div className="article-card-content"><h3>{a.locked&&<LockKeyhole className="card-lock" size={17} aria-label="密码保护"/>}<Link href={`/posts/${a.id}`}>{a.title}</Link>{a.pinned&&<Pin className="card-pin" size={13} aria-label="置顶"/>}</h3>{a.summary&&<p className="card-summary">{a.summary}</p>}<div className="card-bottom"><time dateTime={a.createdAt}>{dateText(a.createdAt)}</time></div></div>
</article>;}

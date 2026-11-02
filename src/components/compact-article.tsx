import Link from 'next/link';
import { LockKeyhole } from 'lucide-react';
import type { PublicArticle } from '@/lib/model';

export function CompactArticle({article,current=false,onNavigate}:{article:PublicArticle;current?:boolean;onNavigate?:()=>void}){
  return <article className={`compact-article${current?' is-current':''}`}>
    <h3>{article.locked&&<LockKeyhole size={15} aria-label="密码保护"/>}<Link href={`/posts/${article.id}`} aria-current={current?'page':undefined} onClick={onNavigate}>{article.title}</Link></h3>
    <p className="compact-summary" aria-hidden={!article.summary||undefined}>{article.summary||'\u00a0'}</p>
  </article>;
}

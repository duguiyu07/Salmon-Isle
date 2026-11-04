import {ArrowUpRight} from 'lucide-react';
import {publishedHref} from '@/lib/admin-view';

export function OpenArticle({article,className='text-button'}:{article?:Parameters<typeof publishedHref>[0];className?:string}){
  const href=article?publishedHref(article):null;
  return href?<a className={className} href={href} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={15}/>打开</a>:<button type="button" className={className} disabled title="发布后可打开"><ArrowUpRight size={15}/>打开</button>;
}

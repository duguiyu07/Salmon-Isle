import type { MetadataRoute } from 'next';
import { listArticles } from '@/lib/storage';
import { visibility } from '@/lib/access';
export const dynamic='force-dynamic';
export default function sitemap():MetadataRoute.Sitemap{const origin=process.env.SALMON_ORIGIN||'http://localhost:3000';return Array.from(new Map([{url:origin},{url:origin+'/knowledge'},...listArticles().filter(a=>a.status==='published'&&!visibility(a).restricted).map(a=>({url:origin+(a.kind==='page'&&a.route?a.route:`/posts/${a.id}`),lastModified:new Date(a.updatedAt)}))].map(item=>[item.url,item])).values());}

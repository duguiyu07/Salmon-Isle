import {notFound,redirect} from 'next/navigation';
import {listArticles,listFolders} from '@/lib/storage';
import {getViewer} from '@/lib/auth';
import {visibility,folderVisible} from '@/lib/access';
import {articleForEditorViewer} from '@/lib/editor-drafts';
import {ManagedPage} from '@/components/managed-page';

type Props={params:Promise<{slug:string[]}>;searchParams:Promise<Record<string,string|undefined>>};
export async function generateMetadata({params}:Props){
  const route='/'+(await params).slug.join('/'),page=listArticles().find(a=>a.kind==='page'&&a.route===route);
  if(!page||visibility(page).hidden)return {robots:{index:false,follow:false}};
  return {title:page.title,description:visibility(page).restricted?'受密码保护的页面':page.summary};
}
export default async function Alias({params,searchParams}:Props){
  const slug='/'+(await params).slug.join('/'),query=await searchParams;
  const suffix=new URLSearchParams(Object.entries(query).filter((entry):entry is [string,string]=>entry[1]!==undefined)).toString();
  const target=listArticles().find(a=>a.route===slug||a.aliases.includes(slug+(suffix?'?'+suffix:''))||a.aliases.includes(slug));
  const viewer=await getViewer();
  if(target&&(viewer.admin||!visibility(target).hidden)){
    const article=articleForEditorViewer(target,viewer.admin);
    if(article.kind==='page'&&article.contentFormat==='html'){
      if(article.route&&article.route!==slug)redirect(article.route+(suffix?'?'+suffix:''));
      return <ManagedPage page={article} viewer={viewer} query={query}/>;
    }
    redirect(`/posts/${article.id}${query.page?'?page='+encodeURIComponent(query.page):''}`);
  }
  const folders=listFolders(),folder=folders.find(f=>f.aliases?.includes(slug));
  if(folder&&folderVisible(folder,folders,viewer))redirect(`/knowledge?folder=${folder.id}`);
  notFound();
}

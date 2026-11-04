import {notFound,redirect} from 'next/navigation';
import {getViewer} from '@/lib/auth';
import {withWorkspace} from '@/lib/library-context';
import {findArticle} from '@/lib/storage';
import {adminHref} from '@/lib/admin-view';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false}};
export default async function WorkspacePreview({params}:{params:Promise<{id:string}>}){
  if(!(await getViewer()).admin)notFound();
  const {id}=await params,article=withWorkspace(()=>findArticle(id));
  if(!article)notFound();
  redirect(adminHref({section:article.kind==='page'?'pages':'articles',edit:article.id}));
}

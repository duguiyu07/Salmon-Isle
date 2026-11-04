import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { listArticles,listFolders,listTrash,getSettings } from '@/lib/storage';
import { AdminWorkspace } from '@/components/admin-workspace';
import {listEditorDrafts} from '@/lib/editor-drafts';
import {withWorkspace} from '@/lib/library-context';
export const dynamic='force-dynamic';export const metadata={title:'写作空间',robots:{index:false,follow:false}};
export default async function Admin(){if(!(await getViewer()).admin)redirect('/admin/login');return withWorkspace(()=>{const content=listArticles(),articles=content.map(({passwordHash,body:_body,css:_css,...a})=>({...a,hasPassword:!!passwordHash}));const folders=listFolders().map(({passwordHash,...f})=>({...f,hasPassword:!!passwordHash}));return <AdminWorkspace initial={{articles:articles.filter(a=>a.kind==='post'),pages:articles.filter(a=>a.kind==='page'),editorDrafts:listEditorDrafts(content),folders,trash:listTrash(),settings:getSettings()}}/>;});}

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { listArticles,listFolders,listTrash,getSettings } from '@/lib/storage';
import { AdminWorkspace } from '@/components/admin-workspace';
import {listEditorDrafts} from '@/lib/editor-drafts';
import {withWorkspace,isDesktop,repositoryConfig} from '@/lib/library-context';
export const dynamic='force-dynamic';export const metadata={title:'写作空间',robots:{index:false,follow:false}};
export default async function Admin(){if(!(await getViewer()).admin)redirect('/admin/login');return withWorkspace(()=>{const articles=listArticles().map(({passwordHash,...a})=>({...a,hasPassword:!!passwordHash}));const folders=listFolders().map(({passwordHash,...f})=>({...f,hasPassword:!!passwordHash}));return <AdminWorkspace initial={{articles:articles.filter(a=>a.kind==='post'),pages:articles.filter(a=>a.kind==='page'),editorDrafts:listEditorDrafts(),folders,trash:listTrash(),settings:getSettings(),desktop:isDesktop(),gitEnabled:false}}/>;});}

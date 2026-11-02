import { redirect } from 'next/navigation';
import { getViewer,adminHash } from '@/lib/auth';
import { AdminLogin } from '@/components/admin-login';
export const dynamic='force-dynamic';export const metadata={title:'管理登录',robots:{index:false,follow:false}};
export default async function Login(){if((await getViewer()).admin)redirect('/admin');return <AdminLogin setup={!adminHash()}/>;}

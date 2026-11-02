import { SiteFrame } from '@/components/site-chrome';
import { getSettings } from '@/lib/storage';
export const dynamic='force-dynamic';
export default function SiteLayout({children}:{children:React.ReactNode}){return <SiteFrame settings={getSettings()}>{children}</SiteFrame>;}

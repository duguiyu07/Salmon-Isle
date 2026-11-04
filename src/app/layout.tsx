import type { Metadata } from 'next';
import '../../public/fonts/fonts.css';
import {staticAsset} from '@/lib/static-asset';
import './globals.css';
import './refinements.css';
import '@milkdown/kit/prose/view/style/prosemirror.css';
import 'katex/dist/katex.min.css';
import './writing.css';
import './motion.css';
import './library.css';
export const metadata:Metadata={title:{default:'Salmon Isle · Everyday is night',template:'%s – Salmon Isle'},description:'一座位于大洋某处的小岛。记录、整理，然后继续探索。',icons:{icon:staticAsset('/brand/logo.png')}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN" data-scroll-behavior="smooth" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:`try{var t=localStorage.getItem('salmon-theme');document.documentElement.dataset.theme=t||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')}catch(e){}`}}/></head><body><a className="skip-link" href="#main">跳至正文</a>{children}</body></html>;}

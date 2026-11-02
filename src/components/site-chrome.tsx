'use client';
import Link from 'next/link';
import { useEffect,useRef,useState } from 'react';
import { Moon,Sun,Search,ArrowUpRight,X } from 'lucide-react';
import { SiteSettings } from '@/lib/model';
import { usePathname } from 'next/navigation';
export function SiteFrame({settings,children}:{settings:SiteSettings;children:React.ReactNode}){const article=usePathname().startsWith('/posts/');return article?<>{children}</>:<><SiteHeader settings={settings}/>{children}<SiteFooter settings={settings}/></>;}
export function SiteHeader({settings}:{settings:SiteSettings}){
  const [dark,setDark]=useState(false);const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{setDark(document.documentElement.dataset.theme==='dark');},[]);
  function toggle(){const value=!dark;setDark(value);document.documentElement.dataset.theme=value?'dark':'light';localStorage.setItem('salmon-theme',value?'dark':'light');window.dispatchEvent(new Event('salmon-theme'));}
  return <header className="site-header reading-width">
    <Link href="/" className="site-logo" aria-label="回到首页"><img src={settings.logo} alt="Salmon Isle" width="86" height="86"/></Link>
    <div className="site-identity"><Link href="/" className="site-name">{settings.title}</Link><p><a href={`mailto:${settings.email}`}>{settings.email}</a></p></div>
    <div className="site-navigation"><nav aria-label="主导航">{settings.navigation.map(n=><Link className="outline-link" href={n.href} key={n.href}>{n.label}</Link>)}</nav><div className="header-tools"><button className="icon-button" onClick={()=>dialog.current?.showModal()} aria-label="搜索文章"><Search size={21}/></button><button className="icon-button" onClick={toggle} aria-label={dark?'切换浅色模式':'切换深色模式'}>{dark?<Sun size={22}/>:<Moon size={22}/>}</button></div></div>
    <dialog className="search-dialog" ref={dialog} onClick={e=>{if(e.target===dialog.current)dialog.current.close();}}><div className="dialog-heading"><span>在岛上寻找</span><button className="icon-button" onClick={()=>dialog.current?.close()} aria-label="关闭搜索"><X size={20}/></button></div><form action="/search" onSubmit={()=>dialog.current?.close()}><Search size={22}/><input name="q" placeholder="搜索文章标题与内容…" aria-label="搜索关键词" autoFocus required/><button className="button primary">搜索</button></form><p className="muted small">支持中文关键词。密码文章仅检索标题。</p></dialog>
  </header>;
}
export function SiteFooter({settings}:{settings:SiteSettings}){return <footer className="site-footer reading-width"><div className="footer-bottom"><div>{settings.footer&&<a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">{settings.footer}<ArrowUpRight size={14}/></a>}</div><span>©2025–{new Date().getFullYear()}</span></div></footer>;}

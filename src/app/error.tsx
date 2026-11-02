'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main id="main" className="reading-width empty-state"><h1>页面暂时未能打开</h1><p>请稍后重试。若问题持续，可检查服务器日志。</p><button className="button" onClick={reset}>重新加载</button></main>;}

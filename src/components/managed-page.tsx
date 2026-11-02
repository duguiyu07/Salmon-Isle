import {notFound} from 'next/navigation';
import {canRead,visibility} from '@/lib/access';
import {getSettings} from '@/lib/storage';
import {renderHtmlPage,type PageQuery} from '@/lib/html-pages';
import type {Article,Viewer} from '@/lib/model';
import {Giscus,MarkdownBody,UnlockForm} from './reader';

export async function ManagedPage({page,viewer,query={}}:{page:Article;viewer:Viewer;query?:PageQuery}){
  const rule=visibility(page);if(!viewer.admin&&rule.hidden)notFound();
  const readable=canRead(page,viewer),gate=rule.gates.find(g=>!viewer.grants.has(g.fingerprint));
  const result=readable?await renderHtmlPage(page,viewer,query):null,settings=getSettings();
  const comments=readable&&!rule.restricted&&settings.giscus.enabled&&settings.giscus.repo&&['/misc','/links'].includes(page.route||'');
  return <main id="main" className={`managed-page ${result?.className||'reading-width standalone-page'}`} data-page-id={page.id}>
    {page.status==='draft'&&<span className="status-badge">草稿 · 仅管理员可见</span>}
    {result?<><style>{result.css}</style><MarkdownBody html={result.html} className={['/','/knowledge'].includes(page.route||'')?'page-html-body':'markdown-body'}/>{comments&&<Giscus config={settings.giscus} term={page.giscusTerm||`salmon:${page.id}`}/>}</>:gate?<UnlockForm articleId={page.id} gateId={gate.id} name={gate.name}/>:null}
  </main>;
}

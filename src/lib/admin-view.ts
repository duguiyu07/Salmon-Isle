export const adminSections=['articles','pages','media','trash','settings','import','updates'] as const;
export interface AdminView {section:string;folder:string;q:string;status:string;edit?:string;new?:'post'|'page'}
export function parseAdminView(params:Pick<URLSearchParams,'get'>):AdminView{
  const section=params.get('section')||'articles',kind=params.get('new');
  return {section:adminSections.includes(section as any)?section:'articles',folder:params.get('folder')||'root',q:params.get('q')||'',status:['published','draft'].includes(params.get('status')||'')?params.get('status')!:'all',edit:params.get('edit')||undefined,new:kind==='post'||kind==='page'?kind:undefined};
}
export function adminHref(view:Partial<AdminView>={}){
  const params=new URLSearchParams();params.set('section',view.section||'articles');
  if(view.folder&&view.folder!=='root')params.set('folder',view.folder);
  if(view.q)params.set('q',view.q);if(view.status&&view.status!=='all')params.set('status',view.status);
  if(view.edit)params.set('edit',view.edit);else if(view.new)params.set('new',view.new);
  return '/admin?'+params;
}
export function lastModified(article:{updatedAt:string},draft?:{savedAt:string}){return draft&&draft.savedAt>article.updatedAt?draft.savedAt:article.updatedAt;}
export function publishedHref(article:{id?:string;kind?:string;status?:string;route?:string}){
  if(article.status!=='published'||!article.id)return null;
  return article.kind==='page'&&article.route?article.route:'/posts/'+encodeURIComponent(article.id);
}

export function paginate<T>(items:T[],page:unknown,perPage:number){
  const pages=Math.max(1,Math.ceil(items.length/perPage));
  const requested=Number(page);
  const current=Math.min(pages,Math.max(1,Number.isFinite(requested)?Math.trunc(requested):1));
  return {items:items.slice((current-1)*perPage,current*perPage),current,pages,total:items.length};
}
export function archiveHref(page:number,filters:{folder?:string;q?:string;sort?:string}){
  const query=new URLSearchParams();
  for(const key of ['folder','q','sort'] as const)if(filters[key]&&(key!=='folder'||filters[key]!=='root'))query.set(key,filters[key]!);
  if(page>1)query.set('page',String(page));
  return '/knowledge'+(query.size?'?'+query.toString():'');
}

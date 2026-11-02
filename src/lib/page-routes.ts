export function normalizePageRoute(value:string){
  if(value.trim().startsWith('//'))return null;
  const route=value.trim().replace(/\/+$/,'')||'/';
  if(!route.startsWith('/')||route.startsWith('//')||/[?#\\\s\u0000-\u001f]/.test(route)||route.includes('..')||/%2f|%5c|%2e/i.test(route))return null;
  if(/^\/(?:api|admin|posts|search|_next|brand|fonts)(?:\/|$)/.test(route)||['/rss.xml','/sitemap.xml','/robots.txt','/favicon.ico'].includes(route))return null;
  return route;
}

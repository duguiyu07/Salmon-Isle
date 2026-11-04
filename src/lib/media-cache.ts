import type {BigIntStats} from 'node:fs';
import {digest} from './crypto';
export function mediaCacheHeaders(file:string,stat:BigIntStats){
  return {'Cache-Control':'private, no-cache','ETag':`W/"${digest(`${file}:${stat.size}:${stat.mtimeNs}`).slice(0,32)}"`,'Last-Modified':new Date(Number(stat.mtimeMs)).toUTCString(),'Vary':'Cookie'};
}
/** Must be called only after checking access and confirming the current file exists. */
export function mediaNotModified(request:Request,headers:ReturnType<typeof mediaCacheHeaders>){
  const match=request.headers.get('if-none-match');
  if(match!==null)return match.split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===headers.ETag.replace(/^W\//,''));
  const since=request.headers.get('if-modified-since');return !!since&&Number.isFinite(Date.parse(since))&&Date.parse(since)>=Date.parse(headers['Last-Modified']);
}

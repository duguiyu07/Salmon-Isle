import { AppError } from './model';
export function sameOrigin(request:Request){
  const origin=request.headers.get('origin');if(!origin)throw new AppError('请求缺少来源信息',403);
  const address=new URL(request.url);
  const expected=process.env.SALMON_ORIGIN||`${address.protocol}//${request.headers.get('host')||address.host}`;
  if(origin!==expected)throw new AppError('请求来源不匹配',403);
}
export async function jsonBody(request:Request,limit=12*1024*1024){const bytes=await request.text();if(Buffer.byteLength(bytes)>limit)throw new AppError('请求过大',413);try{return JSON.parse(bytes);}catch{throw new AppError('无效的 JSON');}}
export function fail(error:unknown){console.error(error instanceof AppError?`Request ${error.status}: ${error.message}`:error);return Response.json({error:error instanceof AppError?error.message:'操作失败，请查看服务器日志。'},{status:error instanceof AppError?error.status:500,headers:{'Cache-Control':'no-store'}});}
export function ok(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});}

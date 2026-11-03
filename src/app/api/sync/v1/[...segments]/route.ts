import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {adminHash} from '@/lib/auth';
import {digest,token,verifyPassword} from '@/lib/crypto';
import {throttle} from '@/lib/db';
import {applyPatch,beginDirectLibrary,blobPath,keepBlob,libraryIdentity,snapshot,syncDb} from '@/lib/direct-library';
import {applyServerOperation} from '@/lib/sync-engine';
import {isDesktop,runtimeDir,withWorkspace} from '@/lib/library-context';
import {withRepositoryLock} from '@/lib/repository-lock';
import {jsonBody,ok,fail} from '@/lib/http';
import {AppError} from '@/lib/model';
import {syncProtocol,type SyncOperation} from '@/lib/sync-model';

export const runtime='nodejs';export const dynamic='force-dynamic';
type Context={params:Promise<{segments:string[]}>};
function authorized(request:Request){const value=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!value)throw new AppError('请重新连接网站',401);const row=syncDb().prepare('SELECT id,credential FROM sync_devices WHERE secret=?').get(digest(value)) as {id:string;credential:string}|undefined;if(!row||row.credential!==digest(adminHash()))throw new AppError('设备连接已失效，请重新登录',401);return row;}
function settings(){const file=path.join(runtimeDir(),'site.yml');return fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;}
async function handler(request:Request,context:Context){try{
 if(isDesktop())throw new AppError('此接口仅在网站端提供',404);beginDirectLibrary();const {segments:s}=await context.params;
 if(s[0]==='connect'&&request.method==='POST'){
  const input=z.object({password:z.string().max(1024),replace:z.boolean().optional()}).parse(await jsonBody(request,4096));
  if(!throttle('sync-connect',8)||!verifyPassword(input.password,adminHash()))throw new AppError('管理密码错误或尝试次数过多',401);
  return await withRepositoryLock(()=>{if((syncDb().prepare('SELECT COUNT(*) AS n FROM sync_devices').get() as {n:number}).n&&!input.replace)throw new AppError('已有写入设备，请勾选替换后重新连接',409);const id=randomUUID(),secret=token();syncDb().prepare('DELETE FROM sync_devices').run();syncDb().prepare('INSERT INTO sync_devices VALUES(?,?,?,?)').run(id,digest(secret),digest(adminHash()),new Date().toISOString());return ok({protocol:syncProtocol,deviceId:id,secret,...libraryIdentity()});});
 }
 authorized(request);
 if(s[0]==='identity')return ok({protocol:syncProtocol,...libraryIdentity()});
 if(s[0]==='media'&&s[1]){
  const file=blobPath(s[1]);if(request.method==='PUT'){
   if(fs.existsSync(file))return ok({stored:true});const reader=request.body?.getReader(),parts:Uint8Array[]=[];let size=0;
   if(reader)for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>40*1024*1024){await reader.cancel();throw new AppError('附件不能超过 40MB',413);}parts.push(chunk.value);}
   const bytes=Buffer.concat(parts);if(digest(bytes)!==s[1])throw new AppError('附件校验失败');keepBlob(bytes);return ok({stored:true});
  }
  if(!fs.existsSync(file))throw new AppError('附件不存在',404);return new Response(request.method==='HEAD'?null:new Uint8Array(fs.readFileSync(file)),{headers:{'Content-Type':'application/octet-stream','Cache-Control':'private, no-store'}});
 }
 if(s[0]==='bootstrap')return await withRepositoryLock(()=>withWorkspace(()=>ok({...libraryIdentity(),files:snapshot(),settings:settings()})));
 if(s[0]==='changes'){const after=Number(new URL(request.url).searchParams.get('after'))||0;for(const row of syncDb().prepare('SELECT id,seq,payload FROM sync_receipts WHERE seq<=?').all(after)){const receipt=JSON.parse(String(row.payload));if(receipt.patch||receipt.result)syncDb().prepare('UPDATE sync_receipts SET payload=? WHERE id=?').run(JSON.stringify({id:row.id,cursor:row.seq}),row.id);}return ok({...libraryIdentity(),settings:settings(),operations:syncDb().prepare('SELECT payload FROM sync_receipts WHERE seq>? ORDER BY seq LIMIT 100').all(after).map(row=>JSON.parse(String(row.payload)))});}
 if(s[0]==='operations'&&request.method==='POST'){
  const input=z.object({id:z.string().uuid(),kind:z.enum(['draft','structural','publish','unpublish']),target:z.string().max(100).optional(),libraryId:z.string().uuid(),generation:z.string().uuid(),tokens:z.object({baseVersion:z.string().nullable(),draftVersion:z.string().nullable()}).optional(),patch:z.object({files:z.array(z.object({path:z.string().max(2000),hash:z.string().regex(/^[a-f0-9]{64}$/),data:z.string().optional(),blob:z.boolean().optional()})).max(20000),deleted:z.array(z.string()).max(20000)}).optional()}).parse(await jsonBody(request,32*1024*1024));
  return await withRepositoryLock(()=>withWorkspace(()=>ok(applyServerOperation(input as SyncOperation))));
 }
 if(s[0]==='operations'&&s[1]){const row=syncDb().prepare('SELECT payload FROM sync_receipts WHERE id=?').get(s[1]) as {payload:string}|undefined;return row?ok(JSON.parse(row.payload)):ok({pending:true},202);}
 if(s[0]==='events'){
  const encoder=new TextEncoder();let cleanup=()=>{};const stream=new ReadableStream({start(controller){let closed=false;const send=()=>{if(closed)return;try{authorized(request);controller.enqueue(encoder.encode('data: '+JSON.stringify(libraryIdentity())+'\n\n'));}catch{closed=true;clearInterval(timer);controller.close();}};const timer=setInterval(send,15000);timer.unref();cleanup=()=>{if(!closed){closed=true;clearInterval(timer);controller.close();}};request.signal.addEventListener('abort',cleanup,{once:true});send();},cancel(){cleanup();}});
  return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no','Connection':'keep-alive'}});
 }
 throw new AppError('同步接口不存在',404);
}catch(error){return fail(error);}}
export const GET=handler;export const POST=handler;export const PUT=handler;export const HEAD=handler;

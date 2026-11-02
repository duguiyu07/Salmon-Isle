import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {generateKeyPairSync,createHmac,verify} from 'node:crypto';
import {beginGithubAuthorization,completeGithubManifest,beginGithubUserAuthorization,completeGithubAuthorization,githubGitToken,githubConnectionStatus,verifyGithubWebhook,webhookMatchesRepository,githubRepository} from '../src/lib/github-auth';
import {closeDatabases} from '../src/lib/db';
const previous={...process.env};let root:string,server:http.Server,installationAllowed:boolean,tokenRequests:number,requests:{url:string;body:any}[];
const pair=generateKeyPairSync('rsa',{modulusLength:2048}),privateKey=pair.privateKey.export({type:'pkcs8',format:'pem'}).toString();
beforeEach(async()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'salmon-github-auth-'));process.env.SALMON_DATA_DIR=root;Object.assign(process.env,{NODE_ENV:'test'});delete process.env.SALMON_DESKTOP;
  installationAllowed=true;tokenRequests=0;requests=[];
  server=http.createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;requests.push({url:req.url!,body});
    const send=(value:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    if(req.url==='/app-manifests/manifest-code/conversions')return send({id:123,pem:privateKey,client_id:'client-id',client_secret:'client-secret',webhook_secret:'webhook-secret',slug:'salmon-test'});
    if(req.url==='/login/oauth/access_token')return send({access_token:'user-token'});
    if(req.url==='/repos/owner/content/installation'){
      const token=req.headers.authorization?.slice(7)||'',parts=token.split('.');
      assert.equal(verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),pair.publicKey,Buffer.from(parts[2],'base64url')),true);
      return send({id:456,app_id:123,permissions:{contents:'write'}});
    }
    if(req.url?.startsWith('/user/installations'))return send({installations:installationAllowed?[{id:456,app_id:123}]:[{id:999,app_id:123}]});
    if(req.url==='/repos/owner/content')return send({id:789,default_branch:'writing',private:true});
    if(req.url==='/app/installations/456/access_tokens'){tokenRequests++;assert.deepEqual(body.repository_ids,[789]);return send({token:'installation-token-'+tokenRequests,expires_at:new Date(Date.now()+3600000).toISOString()});}
    send({error:'unexpected endpoint'},404);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as {port:number};
  process.env.SALMON_GITHUB_API_TEST_URL='http://127.0.0.1:'+address.port;process.env.SALMON_GITHUB_OAUTH_TEST_URL=process.env.SALMON_GITHUB_API_TEST_URL;
});
afterEach(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));closeDatabases();for(const key of Object.keys(process.env))if(key.startsWith('SALMON_'))delete process.env[key];Object.assign(process.env,Object.fromEntries(Object.entries(previous).filter(([key])=>key.startsWith('SALMON_'))));Object.assign(process.env,{NODE_ENV:previous.NODE_ENV});assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'salmon-github-auth-'));fs.rmSync(root,{recursive:true,force:true});});
async function authorization(){
  const flow=beginGithubAuthorization('https://github.com/owner/content.git','https://site.test','admin-session');
  await completeGithubManifest(flow.state,'manifest-code','admin-session');beginGithubUserAuthorization(flow.state,'admin-session');return flow;
}
test('manifest binds the admin session, requests only content permissions and consumes callback states',async()=>{
  const flow=beginGithubAuthorization('https://github.com/owner/content.git','https://site.test','admin-session');
  assert.deepEqual(flow.manifest!.default_permissions,{contents:'write',metadata:'read'});assert.equal(flow.manifest!.public,false);
  await assert.rejects(()=>completeGithubManifest(flow.state,'manifest-code','wrong-session'),/状态/);
  assert.match(await completeGithubManifest(flow.state,'manifest-code','admin-session'),/installations\/new/);
  await assert.rejects(()=>completeGithubManifest(flow.state,'manifest-code','admin-session'),/已使用/);
  assert.match(beginGithubUserAuthorization(flow.state,'admin-session'),/login\/oauth\/authorize/);
  assert.throws(()=>beginGithubUserAuthorization(flow.state,'admin-session'),/已使用/);
  assert.equal(githubConnectionStatus().authorized,false);
});
test('installation ownership is checked and secrets are not returned to the UI',async()=>{
  const flow=await authorization();installationAllowed=false;
  await assert.rejects(()=>completeGithubAuthorization(flow.state,'oauth-code','admin-session'),/未授权/);assert.equal(githubConnectionStatus().authorized,false);
  installationAllowed=true;const result=await completeGithubAuthorization(flow.state,'oauth-code','admin-session');
  assert.deepEqual(result,{remote:'https://github.com/owner/content.git',branch:'writing',origin:'https://site.test'});
  assert.deepEqual(githubConnectionStatus(),{authorized:true,repository:'owner/content'});
  assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(await githubGitToken('https://github.com/other/repo.git'),null);
  const reauthorize=beginGithubAuthorization(result.remote,result.origin,'admin-session');assert.match(reauthorize.redirect,/installations\/new/);assert.equal(reauthorize.manifest,null);
});
test('installation tokens are repository scoped, cached, renewed and used to verify webhook signatures',async t=>{
  const flow=await authorization();await completeGithubAuthorization(flow.state,'oauth-code','admin-session');
  assert.equal(await githubGitToken('https://github.com/owner/content.git'),'installation-token-1');assert.equal(tokenRequests,1);
  const now=Date.now();t.mock.method(Date,'now',()=>now+3590000);
  assert.equal(await githubGitToken('https://github.com/owner/content.git'),'installation-token-2');assert.equal(tokenRequests,2);
  const body=Buffer.from(JSON.stringify({repository:{id:789},installation:{id:456}})),signature='sha256='+createHmac('sha256','webhook-secret').update(body).digest('hex');
  assert.equal(verifyGithubWebhook(body,signature),true);assert.equal(verifyGithubWebhook(Buffer.from('changed'),signature),false);assert.equal(verifyGithubWebhook(body,'short'),false);
  assert.equal(webhookMatchesRepository(JSON.parse(body.toString())),true);assert.equal(webhookMatchesRepository({repository:{id:123},installation:{id:456}}),false);
});
test('authorization validates repository URLs and production HTTPS origins',()=>{
  assert.throws(()=>githubRepository('https://token@github.com/owner/content.git'),/HTTPS/);
  assert.throws(()=>beginGithubAuthorization('https://github.com/owner/content.git','http://site.test','session'),/HTTPS/);
  assert.equal(githubRepository('https://github.com/owner/content').remote,'https://github.com/owner/content.git');
});

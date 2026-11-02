const fs=require('node:fs');
const path=require('node:path');
const {parse}=require('yaml');
function createUpdates({app,updater,saveBeforeInstall,defaults={},packagedConfigPath}){
  const profile=path.join(app.getPath('userData'),'program-update-source.json'),providerFile=path.join(app.getPath('userData'),'update-provider.yml');
  let saved={};try{if(fs.existsSync(profile))saved=JSON.parse(fs.readFileSync(profile,'utf8'));}catch{}
  let feedUrl=saved.feedUrl||defaults.url||'',busy=false;
  let state={phase:feedUrl?'idle':'unconfigured',currentVersion:app.getVersion(),feedUrl,version:null,progress:0,error:''};
  const update=value=>{state={...state,...value};};
  updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;updater.allowPrerelease=false;updater.disableWebInstaller=true;
  updater.on('checking-for-update',()=>update({phase:'checking',error:''}));
  updater.on('update-available',info=>update({phase:'available',version:info.version,progress:0,error:''}));
  updater.on('update-not-available',()=>update({phase:'current',version:null,error:''}));
  updater.on('download-progress',info=>update({phase:'downloading',progress:Math.max(0,Math.min(100,info.percent||0))}));
  updater.on('update-downloaded',info=>update({phase:'ready',version:info.version,progress:100,error:''}));
  updater.on('error',()=>update({phase:'error',error:'更新失败，请检查网络或更新源后重试。当前安装和本地内容不受影响。'}));
  function configure(value){
    const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('请填写不含凭据和查询参数的 HTTPS 更新目录地址');
    url.pathname=url.pathname.replace(/\/?$/,'/');feedUrl=url.href;
    fs.mkdirSync(app.getPath('userData'),{recursive:true});
    fs.writeFileSync(profile+'.tmp',JSON.stringify({feedUrl}),{mode:0o600});fs.renameSync(profile+'.tmp',profile);
    const packaged=packagedConfigPath&&fs.existsSync(packagedConfigPath)?parse(fs.readFileSync(packagedConfigPath,'utf8'))||{}:{};
    const config={...packaged,provider:'generic',url:feedUrl,...(defaults.publisherName?{publisherName:defaults.publisherName}:{})};
    fs.writeFileSync(providerFile,JSON.stringify(config),{mode:0o600});updater.updateConfigPath=providerFile;updater.setFeedURL({provider:'generic',url:feedUrl});
    update({feedUrl,phase:'idle',version:null,error:''});
  }
  async function run(action){
    if(busy)throw new Error('正在处理另一项更新操作');busy=true;
    try{await action();return {...state};}catch(error){update({phase:state.phase==='ready'?'ready':'error',error:error.message||'更新失败，请重试'});throw error;}finally{busy=false;}
  }
  return {
    status:()=>({...state}),
    check:value=>run(async()=>{if(value)configure(value);else if(feedUrl)configure(feedUrl);else throw new Error('请先填写程序更新目录地址');await updater.checkForUpdates();}),
    download:()=>run(async()=>{if(state.phase!=='available')throw new Error('请先检查并选择可用的新版本');update({phase:'downloading',progress:0,error:''});await updater.downloadUpdate();}),
    install:()=>run(async()=>{if(state.phase!=='ready')throw new Error('更新尚未下载完成');if(!app.isPackaged)throw new Error('开发模式不执行安装');await saveBeforeInstall();updater.quitAndInstall(false,true);})
  };
}
module.exports={createUpdates};

const {app,BrowserWindow,utilityProcess,session,ipcMain,dialog,shell,safeStorage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {randomBytes}=require('node:crypto');

let server,origin='',token='',logFile='',installingUpdate=false;
const smoke=process.argv.includes('--smoke');
if(smoke&&process.env.SALMON_DESKTOP_DATA_DIR)app.setPath('userData',path.join(path.resolve(process.env.SALMON_DESKTOP_DATA_DIR),'electron-profile'));
const runtime=()=>process.env.SALMON_DESKTOP_DATA_DIR||path.join(app.getPath('userData'),'runtime');
function log(value){if(logFile)fs.appendFileSync(logFile,new Date().toISOString()+' '+String(value)+'\n');}
async function availablePort(){return new Promise((resolve,reject)=>{const socket=net.createServer();socket.on('error',reject);socket.listen(0,'127.0.0.1',()=>{const {port}=socket.address();socket.close(()=>resolve(port));});});}
async function startServer(){
  token=randomBytes(32).toString('hex');fs.mkdirSync(runtime(),{recursive:true});logFile=path.join(runtime(),'desktop.log');
  const inherited={...process.env};for(const key of Object.keys(inherited))if(key.startsWith('SALMON_'))delete inherited[key];
  delete inherited.NODE_PATH;
  const secretFile=path.join(app.getPath('userData'),'sync-secret.bin');
  let syncSecret='';try{if(fs.existsSync(secretFile)&&safeStorage.isEncryptionAvailable())syncSecret=safeStorage.decryptString(fs.readFileSync(secretFile));}catch{log('Saved device credential unavailable; reconnect in sync settings.');}
  for(let attempt=0;attempt<3;attempt++){
    const port=await availablePort();origin='http://127.0.0.1:'+port;
    server=utilityProcess.fork(path.join(__dirname,'utility.cjs'),[],{env:{...inherited,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',HOSTNAME:'127.0.0.1',PORT:String(port),SALMON_ORIGIN:origin,SALMON_DATA_DIR:runtime(),SALMON_DESKTOP:'true',SALMON_DESKTOP_TOKEN:token,SALMON_SYNC_TOKEN:syncSecret},stdio:'pipe',serviceName:'Salmon Isle Content Service'});
    server.stdout?.on('data',data=>log(data.toString()));server.stderr?.on('data',data=>log(data.toString()));
    let exited=false;server.once('exit',code=>{exited=true;log('Service exit '+code);});
    for(let tick=0;tick<240&&!exited;tick++){
      try{const response=await fetch(origin+'/api/health',{headers:{'x-salmon-desktop-token':token},signal:AbortSignal.timeout(1500)});if(response.ok)return;}catch{}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    server.kill();if(!exited&&attempt===2)throw new Error('本地内容服务启动超时，请查看 '+logFile);
  }
  throw new Error('本地服务未能启动，请查看 '+logFile);
}
function trusted(event){if(!event.senderFrame||new URL(event.senderFrame.url).origin!==origin)throw new Error('Untrusted desktop request');}
function createWindow(url=origin+'/admin'){
  const win=new BrowserWindow({width:1360,height:900,minWidth:900,minHeight:620,show:false,title:'Salmon Isle Writer',backgroundColor:'#faf9f6',icon:path.join(__dirname,'icon.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:!smoke,session:session.fromPartition('persist:salmon-writer')}});
  win.removeMenu();if(!smoke)win.once('ready-to-show',()=>win.show());
  win.webContents.setWindowOpenHandler(({url})=>{if(new URL(url).origin===origin){createWindow(url);return {action:'deny'};}if(/^https?:\/\//.test(url))void shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin){event.preventDefault();if(/^https?:\/\//.test(url))void shell.openExternal(url);}});
  let closing=false;
  win.on('close',event=>{if(closing||installingUpdate)return;event.preventDefault();void (async()=>{
    try{await win.webContents.executeJavaScript('window.salmonSaveBeforeExit ? window.salmonSaveBeforeExit().then(() => true) : true');closing=true;win.close();}
    catch(error){const result=await dialog.showMessageBox(win,{type:'warning',message:'当前编辑稿未能保存',detail:String(error),buttons:['继续编辑','退出并保留恢复稿'],defaultId:0,cancelId:0});if(result.response===1){closing=true;win.close();}}
  })();});
  win.webContents.on('will-prevent-unload',event=>{if(closing)event.preventDefault();});void win.loadURL(url);return win;
}
async function runSmoke(){
  const assert=require('node:assert/strict');
  if(!process.env.SALMON_DESKTOP_DATA_DIR)throw new Error('Smoke tests require an isolated SALMON_DESKTOP_DATA_DIR');
  assert.equal((await fetch(origin+'/api/health')).status,403);
  const headers={'x-salmon-desktop-token':token};const response=await fetch(origin+'/admin',{headers});const html=await response.text();assert.equal(response.status,200);assert.match(html,/媒体库/);assert.match(html,/同步/);assert.doesNotMatch(html,/>站点设置</);
  const script=html.match(/src="([^\"]+\.js[^\"]*)"/);assert.ok(script);assert.equal((await fetch(new URL(script[1].replaceAll('&amp;','&'),origin),{headers})).status,200);
  const api=async(url,body,method='POST')=>{const r=await fetch(origin+'/api/'+url,body===undefined?{headers}:{method,headers:{...headers,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await r.json();assert.equal(r.ok,true,JSON.stringify(value));return value;};
  const id='smoke-'+randomBytes(5).toString('hex');
  const saved=await api('admin/editor-drafts',{articleId:id,document:{title:'桌面编辑验证 '+id,body:'**线索二叉树**是一种结构。\n\n',folderId:'root',kind:'post',access:'inherit'},baseVersion:null,draftVersion:null});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');const form=new FormData();form.set('file',new Blob([png],{type:'image/png'}),'smoke-image.png');
  const upload=await fetch(origin+'/api/admin/media',{method:'POST',headers:{...headers,Origin:origin},body:form});assert.equal(upload.ok,true);const media=await upload.json();
  const logoFile=path.join(__dirname,'web','public','brand','logo.png'),logo=fs.existsSync(logoFile)?fs.readFileSync(logoFile):png;
  for(let index=0;index<26;index++){
    const fixture=new FormData();fixture.set('file',new Blob([logo],{type:'image/png'}),'媒体分页验证-'+String(index).padStart(2,'0')+'.png');
    const result=await fetch(origin+'/api/admin/media',{method:'POST',headers:{...headers,Origin:origin},body:fixture});assert.equal(result.ok,true);
  }
  const win=createWindow();const evaluate=win.webContents.executeJavaScript.bind(win.webContents);win.webContents.executeJavaScript=async(script,...args)=>{const result=await evaluate('(async()=>{try{return await (0,eval)('+JSON.stringify(script)+')}catch(error){return {__smokeError:error.message,stack:error.stack}}})()',...args);if(result?.__smokeError)throw new Error(result.__smokeError+'\n'+result.stack+'\nScript: '+script.slice(0,220));return result;};await new Promise((resolve,reject)=>{if(!win.webContents.isLoading())resolve();else {win.webContents.once('did-finish-load',resolve);win.webContents.once('did-fail-load',(_event,code,description)=>reject(new Error(code+' '+description)));}});
  await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 500))');
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.article-title-button')).find(button=>button.textContent.includes(${JSON.stringify(id)})).click()`);
  await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 500))');
  await win.webContents.executeJavaScript('new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(document.querySelector(".visual-document p")){clearInterval(timer);resolve()}else if(++attempts>100){clearInterval(timer);reject(new Error("Visual editor not ready"))}},100)})');
  await win.webContents.executeJavaScript(`(()=>{const editor=document.querySelector('.visual-document');editor.focus();const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);let text;while(text=walker.nextNode()){const at=text.data.indexOf('是一种结构');if(at>=0){const range=document.createRange();range.setStart(text,at+1);range.collapse(true);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);break;}}})()`);
  await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,100))');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Backspace'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Backspace'});
  await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,200))');
  assert.ok(await win.webContents.executeJavaScript("document.querySelector('.visual-document').textContent.includes('**线索二叉树**一种结构')"),'Backspace must retain hidden Markdown closing markers');
  await win.webContents.executeJavaScript(`(()=>{const editor=document.querySelector('.visual-document');const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);let text;while(text=walker.nextNode()){if(text.data.includes('线索二叉树')){const range=document.createRange();range.setStart(text,0);range.setEnd(text,2);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);break;}}})()`);
  await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,200))');
  const selectionGeometry=await win.webContents.executeJavaScript(`(()=>{const panel=document.querySelector('.selection-toolbar');if(!panel)return null;const box=panel.getBoundingClientRect(),range=window.getSelection().getRangeAt(0).getBoundingClientRect();return {sizes:[...panel.querySelectorAll('button')].map(button=>[button.offsetWidth,button.offsetHeight]),overlap:box.left<range.right&&box.right>range.left&&box.top<range.bottom&&box.bottom>range.top};})()`);
  assert.ok(selectionGeometry);assert.equal(selectionGeometry.overlap,false);assert.ok(selectionGeometry.sizes.every(([width,height])=>width===32&&height===32));
  fs.writeFileSync(path.join(runtime(),'desktop-selection-v2.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await win.webContents.executeJavaScript(`(()=>{const editor=document.querySelector('.visual-document');editor.focus();const range=document.createRange();range.selectNodeContents(editor.querySelector('p'));range.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);})()`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
  await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,100))');
  await win.webContents.executeJavaScript("document.querySelector('.writing-toolbar [aria-label=插入图片]').click()");
  await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 500))');
  assert.deepEqual(await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('.image-source-tabs [role=tab]')).map(tab=>tab.textContent)"),['媒体库','上传','URL']);
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('.image-picker').open"),true);
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.image-picker .media-tile').length"),24);
  assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.image-picker')).borderRadius"),'3px');
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('.writing-block-toggle') === null"),true);
  const heights=[];
  for(const label of ['上传','URL','媒体库']){
    await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('.image-source-tabs button')).find(button=>button.textContent==="+JSON.stringify(label)+").click()");
    await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 80))');
    heights.push(await win.webContents.executeJavaScript("document.querySelector('.image-picker').getBoundingClientRect().height"));
  }
  assert.ok(Math.max(...heights)-Math.min(...heights)<1,'image source tabs keep the same dialog height');
  await win.webContents.executeJavaScript('document.getAnimations().forEach(animation => { try { animation.finish(); } catch {} })');
  await win.webContents.executeJavaScript('Promise.all(Array.from(document.images).map(img=>{img.loading="eager";return img.decode().catch(()=>null)}))');
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
  const screenshot=path.join(runtime(),'desktop-media-picker.png');fs.writeFileSync(screenshot,(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await win.webContents.executeJavaScript("document.querySelector('.image-picker .media-tile').click()");await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 150))');await win.webContents.executeJavaScript("document.querySelector('.image-picker .media-details .button.primary').click()");
  await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 200))');await win.webContents.executeJavaScript('window.salmonSaveBeforeExit()');
  await win.webContents.executeJavaScript("document.querySelector('.visual-image img').click()");
  await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,150))');
  const blockGeometry=await win.webContents.executeJavaScript(`(()=>{const panel=document.querySelector('.floating-block-controls');return {width:panel.getBoundingClientRect().width,editorWidth:document.querySelector('.editor-text-area').getBoundingClientRect().width,altInMore:!!panel.querySelector('[aria-label="替代文本"]')?.closest('details'),captionInPanel:!!panel.querySelector('[aria-label="图片说明"]'),imageCenter:(()=>{const image=document.querySelector('.visual-image img').getBoundingClientRect(),area=document.querySelector('.editor-text-area').getBoundingClientRect();return Math.abs(image.left+image.width/2-area.left-area.width/2)})()};})()`);
  assert.ok(Math.abs(blockGeometry.width-blockGeometry.editorWidth)<2);assert.equal(blockGeometry.altInMore,true);assert.equal(blockGeometry.captionInPanel,false);assert.ok(blockGeometry.imageCenter<2,'standalone images should be centered');
  await win.webContents.executeJavaScript("document.querySelector('.content-image-caption').click()");
  await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,100))');
  await win.webContents.executeJavaScript(`(()=>{const input=document.querySelector('.image-caption-editor');input.focus();input.value='图片说明 **加粗**';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,100))');
  await win.webContents.executeJavaScript("document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));document.querySelector('.image-caption-editor').blur()");
  await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,650))');
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('.content-image-caption strong')?.textContent"),'加粗');await win.webContents.executeJavaScript('window.salmonSaveBeforeExit()');
  const edited=await api('admin/editor-drafts/'+id);assert.match(edited.draft.document.body,new RegExp('/api/media/.*\\?article='+id));
  assert.ok((await api('admin/sync/status')).pending>0);
  await api('admin/editor-drafts',{articleId:id,document:{...edited.draft.document,body:edited.draft.document.body+'\n\n待提交的编辑稿。'},baseVersion:edited.article.version,draftVersion:edited.draft.draftVersion});
  await win.loadURL(origin+'/admin');await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 600))');
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('.admin-stats') === null"),true);
  const capture=async name=>{
    await win.webContents.executeJavaScript('document.getAnimations().forEach(animation => { try { animation.finish(); } catch {} })');
    await win.webContents.executeJavaScript('Promise.all(Array.from(document.images).map(img=>{img.loading="eager";return img.decode().catch(()=>null)}))');
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
    fs.writeFileSync(path.join(runtime(),name+'.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  };
  await capture('desktop-articles');
  await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('.admin-primary-nav button')).find(button=>button.textContent==='媒体库').click()");
  await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 650))');
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.media-tile').length"),24);
  await win.webContents.executeJavaScript("document.querySelector('.media-pagination [aria-label=下一页]').click()");
  await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 650))');
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('.media-page-number[aria-current=page]').textContent"),'2');
  assert.ok(await win.webContents.executeJavaScript("document.querySelectorAll('.media-tile').length>0 && document.querySelectorAll('.media-tile').length<=24"));
  await win.webContents.executeJavaScript("document.querySelector('.media-pagination [aria-label=上一页]').click()");
  await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 650))');
  await win.webContents.executeJavaScript("document.documentElement.dataset.theme='dark';document.querySelector('.media-tile').click()");
  await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 200))');await capture('desktop-media-dark');
  await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('.admin-account-nav button')).find(button=>button.textContent==='更新').click()");
  await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 400))');await capture('desktop-updates');
  assert.equal((await win.webContents.executeJavaScript('window.salmonDesktop.updateStatus()')).currentVersion,app.getVersion());
  await require('./smoke-editor.cjs')(win,api,id);
  console.log('Browser editor, image picker, saved draft, and automatic local synchronization passed. Screenshot: '+screenshot);
  console.log(JSON.stringify({desktopSmoke:'passed',runtime:process.versions,standalone:true,unauthorizedStatus:403}));
}
if(!app.requestSingleInstanceLock())app.quit();else{
  app.on('second-instance',()=>{const win=BrowserWindow.getAllWindows()[0];if(win){if(win.isMinimized())win.restore();win.focus();}});
  app.whenReady().then(async()=>{
    try{
      await startServer();
      const partition=session.fromPartition('persist:salmon-writer');
      partition.webRequest.onBeforeSendHeaders({urls:[origin+'/*']},(details,callback)=>{details.requestHeaders['x-salmon-desktop-token']=token;callback({requestHeaders:details.requestHeaders});});
      partition.setPermissionRequestHandler((contents,permission,callback)=>callback(permission==='fullscreen'&&!!contents?.getURL().startsWith(origin+'/')));
      ipcMain.handle('salmon:choose-directory',async event=>{trusted(event);const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'选择内容库目录',properties:['openDirectory','createDirectory']});return result.canceled?null:result.filePaths[0];});
      ipcMain.handle('salmon:default-directory',event=>{trusted(event);return path.join(app.getPath('userData'),'content');});
      const localApi=async(route,body)=>{const response=await fetch(origin+'/api/admin/sync/'+route,{method:'POST',headers:{'x-salmon-desktop-token':token,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body||{})});const data=await response.json();if(!response.ok)throw new Error(data.error||'网站连接失败');return data;};
      const secretFile=path.join(app.getPath('userData'),'sync-secret.bin');
      ipcMain.handle('salmon:connect-site',async(event,input)=>{trusted(event);if(!safeStorage.isEncryptionAvailable())throw new Error('系统凭证加密服务不可用');if(typeof input?.siteUrl!=='string'||typeof input.password!=='string'||input.password.length>1024)throw new Error('连接参数无效');const result=await localApi('connect',input);const temporary=secretFile+'.tmp';fs.writeFileSync(temporary,safeStorage.encryptString(result.secret),{mode:0o600});fs.renameSync(temporary,secretFile);return result.status;});
      ipcMain.handle('salmon:disconnect-site',async event=>{trusted(event);const result=await localApi('disconnect');if(fs.existsSync(secretFile))fs.unlinkSync(secretFile);return result;});
      const recoveryFile=path.join(runtime(),'editor-recovery.json');
      ipcMain.handle('salmon:read-recovery',event=>{trusted(event);return fs.existsSync(recoveryFile)?fs.readFileSync(recoveryFile,'utf8'):null;});
      ipcMain.handle('salmon:write-recovery',(event,value)=>{trusted(event);if(typeof value!=='string'||Buffer.byteLength(value)>12*1024*1024)throw new Error('Invalid recovery document');const document=JSON.parse(value);delete document.password;const temp=recoveryFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(document),{mode:0o600});fs.renameSync(temp,recoveryFile);});
      ipcMain.handle('salmon:clear-recovery',event=>{trusted(event);if(fs.existsSync(recoveryFile))fs.unlinkSync(recoveryFile);});
      const defaultsFile=path.join(__dirname,'update-defaults.json');
      const nativeUpdater=require('electron-updater').autoUpdater;nativeUpdater.on('error',()=>{installingUpdate=false;});
      const updates=require('./updates.cjs').createUpdates({app,updater:nativeUpdater,defaults:fs.existsSync(defaultsFile)?JSON.parse(fs.readFileSync(defaultsFile,'utf8')):{},packagedConfigPath:path.join(process.resourcesPath,'app-update.yml'),saveBeforeInstall:async()=>{
        for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed())await win.webContents.executeJavaScript('window.salmonSaveBeforeExit ? window.salmonSaveBeforeExit() : Promise.resolve()');
        installingUpdate=true;
      }});
      ipcMain.handle('salmon:update-status',event=>{trusted(event);return updates.status();});
      ipcMain.handle('salmon:update-check',(event,url)=>{trusted(event);if(url!==undefined&&(typeof url!=='string'||url.length>2000))throw new Error('无效更新源');return updates.check(url);});
      ipcMain.handle('salmon:update-download',event=>{trusted(event);return updates.download();});
      ipcMain.handle('salmon:update-install',event=>{trusted(event);return updates.install();});
      if(smoke){try{await runSmoke();app.exit(0);}catch(error){console.error(error);app.exit(1);}}
      else createWindow();
    }catch(error){log(error);if(smoke){console.error(error);app.exit(1);}else {dialog.showErrorBox('Salmon Isle Writer 启动失败',String(error));app.quit();}}
  });
  app.on('window-all-closed',()=>app.quit());app.on('before-quit',()=>server?.kill());app.on('will-quit',()=>server?.kill());
}

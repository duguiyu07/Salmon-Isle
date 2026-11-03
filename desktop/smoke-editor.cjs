const assert=require('node:assert/strict');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

module.exports=async function smokeEditor(win,api,id){
 const wc=win.webContents,js=(script)=>Promise.race([wc.executeJavaScript(script,true),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Native editor script timed out: '+script.slice(0,180))),10000);timer.unref();})]),origin=new URL(wc.getURL()).origin;
 const samples=['**线索二叉树**是一种结构','*斜体*是普通文字','~~删除线~~是普通文字','`code`是普通文字','$x$是普通文字','**粗体**👨‍👩‍👧‍👦后续','**中文**输入法测试'];
 const articleId=id+'-keyboard';
 await api('admin/editor-drafts',{articleId,document:{title:'键盘与面板验证 '+articleId,body:[...samples,...Array.from({length:45},(_,i)=>'长选区段落 '+i)].join('\n\n'),folderId:'root',kind:'post'},baseVersion:null,draftVersion:null});
 await win.loadURL(origin+'/admin');
 for(let t=0;t<100;t++){if(await js(`!![...document.querySelectorAll('.article-title-button')].find(b=>b.textContent.includes(${JSON.stringify(articleId)}))`))break;await pause(100);}
 await js(`[...document.querySelectorAll('.article-title-button')].find(b=>b.textContent.includes(${JSON.stringify(articleId)})).click()`);
 for(let t=0;t<100;t++){if(await js(`document.querySelectorAll('.visual-document p').length>=7`))break;await pause(100);}
 const caret=async(index,text,after=true)=>js(`(()=>{const editor=document.querySelector('.visual-document');editor.focus();const p=editor.querySelectorAll('p')[${index}];p.scrollIntoView({block:'center'});const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const at=node.data.indexOf(${JSON.stringify(text)});if(at>=0){const range=document.createRange();range.setStart(node,at+${after?text.length:0});range.collapse(true);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return;}}throw Error('Caret text missing');})()`);
 const backspace=async()=>{await pause(80);wc.sendInputEvent({type:'keyDown',keyCode:'Backspace'});wc.sendInputEvent({type:'keyUp',keyCode:'Backspace'});await pause(120);};
 const body=async()=>{await js('window.salmonSaveBeforeExit()');return (await api('admin/editor-drafts/'+articleId)).draft.document.body;};
 for(let i=0;i<samples.length-1;i++){const deleted=i===5?'👨‍👩‍👧‍👦':'是';await caret(i,deleted);await backspace();assert.ok((await body()).includes(samples[i].replace(deleted,'')),'native Backspace must preserve delimiters: '+samples[i]);}console.log('Native inline deletion passed.');
 await caret(6,'输入法',false);wc.debugger.attach('1.3');
 try {await wc.debugger.sendCommand('Input.imeSetComposition',{text:'测试',selectionStart:2,selectionEnd:2});await pause(80);await wc.debugger.sendCommand('Input.insertText',{text:'测试'});await pause(120);assert.ok((await body()).includes('**中文**测试输入法测试'));await caret(6,'试');await backspace();assert.ok((await body()).includes('**中文**测输入法测试'));}finally{wc.debugger.detach();}
 console.log('Native composition passed.');win.setMinimumSize(480,620);win.setSize(540,740);
 for(const theme of ['light','dark'])for(const zoom of [1,1.25]){
  wc.setZoomFactor(zoom);await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await pause(80);
  await js(`(()=>{const editor=document.querySelector('.visual-document');editor.focus();const p=editor.querySelector('p');p.scrollIntoView({block:'center'});const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const at=node.data.indexOf('线索');if(at>=0){const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+2);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return;}}})()`);await pause(180);
  const geometry=await js(`(()=>{const panel=document.querySelector('.selection-toolbar'),box=panel.getBoundingClientRect(),selected=window.getSelection().getRangeAt(0).getBoundingClientRect();return {visible:getComputedStyle(panel).visibility,overlap:box.left<selected.right&&box.right>selected.left&&box.top<selected.bottom&&box.bottom>selected.top,left:box.left,right:box.right,viewport:innerWidth,sizes:[...panel.querySelectorAll('button')].map(b=>[b.offsetWidth,b.offsetHeight])};})()`);
  assert.equal(geometry.visible,'visible');assert.equal(geometry.overlap,false);assert.ok(geometry.left>=0&&geometry.right<=geometry.viewport+1);assert.ok(geometry.sizes.every(([w,h])=>w===32&&h===32),'narrow tool buttons stay 32 px');
 }
 console.log('Narrow theme/zoom geometry passed.');wc.setZoomFactor(1);win.setSize(1360,900);
 await js(`(()=>{const editor=document.querySelector('.visual-document');editor.focus();const range=document.createRange();range.selectNodeContents(editor);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);window.scrollTo(0,document.body.scrollHeight/2);})()`);await pause(250);
 assert.equal(await js(`(()=>{const panel=document.querySelector('.selection-toolbar');return !!panel?.closest('.editor-panel-dock')&&getComputedStyle(panel).visibility==='visible';})()`),true,'a viewport-spanning selection docks its toolbar instead of hiding it');
 console.log('Long selection dock passed.');
 // Chromium waits for a visible native window before completing fullscreen.
 const visible=win.isVisible();win.showInactive();
 try{await js('document.documentElement.requestFullscreen()');await pause(200);assert.equal(await js(`!!document.fullscreenElement&&!!document.fullscreenElement.querySelector('.selection-toolbar')`),true);await js('document.exitFullscreen()');}finally{if(!visible)win.hide();}
 win.setMinimumSize(900,620);
 console.log(JSON.stringify({nativeKeyboard:'passed',formats:5,emoji:true,composition:true,narrowButtons:32,selectionDock:true,fullscreen:true}));
};

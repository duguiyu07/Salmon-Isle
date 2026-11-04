import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,createRef,useState,act} from 'react';
import {WritingEditor,type WritingDocument,type WritingHandle} from '../src/components/writing-editor';
import {createTestEditor} from './helpers/visual-editor';
import type {EditorMode} from '../src/lib/editor-ui';
import {WritingMenu} from '../src/components/writing-menu';

test('blank-line insertions retain their caret and outside dismissal commits pending style edits',async()=>{
  const setup=await createTestEditor(),container=document.createElement('div');document.body.append(container);
  const {createRoot}=await import('react-dom/client');
  const globals=globalThis as any,previousObserver=globals.ResizeObserver,previousAct=globals.IS_REACT_ACT_ENVIRONMENT,previousWindow=globals.Window;
  class Observer {observe(){}unobserve(){}disconnect(){}}
  globals.ResizeObserver=Observer;(window as any).ResizeObserver=Observer;globals.IS_REACT_ACT_ENVIRONMENT=true;globals.Window=window.Window;window.scrollBy=()=>{};
  const width=Object.getOwnPropertyDescriptor(window,'innerWidth'),height=Object.getOwnPropertyDescriptor(window,'innerHeight');
  Object.defineProperty(window,'innerWidth',{configurable:true,writable:true,value:1440});Object.defineProperty(window,'innerHeight',{configurable:true,writable:true,value:900});
  const oldRect=HTMLElement.prototype.getBoundingClientRect,oldRange=window.Range.prototype.getBoundingClientRect,oldRects=window.Range.prototype.getClientRects;
  const rectangle=(top=200)=>new window.DOMRect(window.innerWidth<=700?18:100,top,window.innerWidth<=700?window.innerWidth-36:860,22);
  HTMLElement.prototype.getBoundingClientRect=function(){return rectangle(this.classList.contains('writing-toolbar')?70:this.classList.contains('visual-container')?320:200);};
  window.Range.prototype.getBoundingClientRect=()=>rectangle();window.Range.prototype.getClientRects=()=>[rectangle()] as unknown as DOMRectList;
  const root=createRoot(container),ref=createRef<WritingHandle>(),errors:string[]=[];let latest:WritingDocument;
  const available=()=>{};
  function Harness(){
    const [doc,setDoc]=useState<WritingDocument>({title:'测试',body:'<br />\n\n:::group{preset="green"}\n正文\n:::',folderId:'root'});
    const [mode,setMode]=useState<EditorMode>('visual');latest=doc;
    return createElement(WritingEditor,{ref,doc,dirty:false,mode,onModeChange:setMode,preview:'',onChange:patch=>setDoc(current=>({...current,...patch})),onUpload:()=>{},onError:message=>errors.push(message),onBlockAvailabilityChange:available});
  }
  try{
    await act(async()=>{root.render(createElement(Harness));});
    for(let index=0;index<30&&container.querySelector('.editor-loading');index++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
    assert.equal(container.querySelector('.editor-loading'),null);
    assert.deepEqual(Array.from(container.querySelectorAll('.writing-tool-group')).map(group=>group.getAttribute('aria-label')),['段落样式','文字格式','列表','撤销／重做','段落操作','文字颜色与背景色','插入']);
    const editor=container.querySelector<HTMLElement>('.visual-document')!;assert.ok(editor);
    await act(async()=>{editor.focus();await Promise.resolve();});
    assert.ok(document.querySelector('.writing-inline-plus'));assert.equal((document.querySelector('.writing-inline-insert') as HTMLElement).style.left,'52px');
    await act(async()=>{Object.defineProperty(window,'innerWidth',{configurable:true,writable:true,value:390});window.dispatchEvent(new Event('resize'));await new Promise(resolve=>setTimeout(resolve,25));});
    assert.equal((document.querySelector('.writing-inline-insert') as HTMLElement).style.left,'344px');
    await act(async()=>{(document.querySelector('.writing-inline-plus') as HTMLButtonElement).click();});
    const menu=document.querySelector('.writing-insert-options')!;
    assert.equal(menu.querySelectorAll('[role=menuitem]').length,12);assert.equal(Array.from(menu.querySelectorAll('button')).find(button=>button.textContent==='HTML')?.querySelectorAll('svg').length,1);
    await act(async()=>{Array.from(menu.querySelectorAll('button')).find(button=>button.textContent==='内容组')!.click();});
    assert.match(latest!.body,/preset="outline"/);assert.equal(container.querySelectorAll('[data-salmon-container=group]').length,2);
    await act(async()=>{container.querySelector<HTMLButtonElement>('[data-salmon-container=group]>.visual-block-bar>button')!.click();});
    const panel=document.querySelector('.floating-block-controls')!;assert.ok(panel);assert.equal(panel.querySelector('.block-context>strong'),null);
    await act(async()=>{(panel.querySelector('.block-style-more') as HTMLDetailsElement).open=true;});
    const input=panel.querySelector<HTMLInputElement>('input[aria-label="边框颜色"]')!;assert.ok(input);
    await act(async()=>{input.focus();input.value='#123456';document.body.dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true}));});
    assert.match(latest!.body,/borderColor="#123456"/);assert.equal(document.querySelector('.floating-block-controls'),null);
    await act(async()=>{window.dispatchEvent(new Event('scroll'));await new Promise(resolve=>setTimeout(resolve,25));});
    assert.equal(document.querySelector('.floating-block-controls'),null);assert.deepEqual(errors,[]);
  }finally{
    await act(async()=>root.unmount());container.remove();
    HTMLElement.prototype.getBoundingClientRect=oldRect;window.Range.prototype.getBoundingClientRect=oldRange;window.Range.prototype.getClientRects=oldRects;
    if(width)Object.defineProperty(window,'innerWidth',width);if(height)Object.defineProperty(window,'innerHeight',height);
    globals.ResizeObserver=previousObserver;globals.IS_REACT_ACT_ENVIRONMENT=previousAct;globals.Window=previousWindow;
    await setup.close();
  }
});

test('the docked menu distinguishes dragging from clicking, traps focus and restores the launcher',async()=>{
  const setup=await createTestEditor(),container=document.createElement('div');document.body.append(container);
  const {createRoot}=await import('react-dom/client'),globals=globalThis as any,previousAct=globals.IS_REACT_ACT_ENVIRONMENT;
  globals.IS_REACT_ACT_ENVIRONMENT=true;const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,value:window.localStorage});
  const oldRects=HTMLElement.prototype.getClientRects,oldCapture=HTMLElement.prototype.setPointerCapture;
  HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[] as unknown as DOMRectList:[new window.DOMRect(0,0,44,44)] as unknown as DOMRectList;};
  HTMLElement.prototype.setPointerCapture=()=>{};
  const root=createRoot(container);
  function Harness(){const [open,setOpen]=useState(false);return createElement(WritingMenu,{open,onOpenChange:setOpen,status:'编辑稿已保存',statusKind:'saved',children:createElement('button',{type:'button'},'保存编辑稿')});}
  try{
    await act(async()=>{root.render(createElement(Harness));});
    const ball=container.querySelector<HTMLButtonElement>('.writing-menu-ball')!;assert.ok(ball);
    await act(async()=>{ball.dispatchEvent(new window.MouseEvent('pointerdown',{button:0,clientX:100,clientY:100,bubbles:true}));ball.dispatchEvent(new window.MouseEvent('pointermove',{clientX:200,clientY:300,bubbles:true}));ball.dispatchEvent(new window.MouseEvent('pointerup',{clientX:200,clientY:300,bubbles:true}));ball.click();});
    assert.equal(ball.style.left,'16px');assert.equal(container.querySelector<HTMLElement>('.writing-menu-panel')!.hidden,true);assert.equal(JSON.parse(localStorage.getItem('salmon-writing-menu-position')!).side,'left');
    ball.focus();await act(async()=>ball.click());
    const panel=container.querySelector<HTMLElement>('.writing-menu-panel')!,controls=panel.querySelectorAll<HTMLButtonElement>('button');
    assert.equal(panel.hidden,false);assert.equal(document.body.style.overflow,'hidden');assert.equal(document.activeElement,controls[0]);
    await act(async()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));});assert.equal(document.activeElement,controls[controls.length-1]);
    await act(async()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));});
    assert.equal(panel.hidden,true);assert.equal(document.body.style.overflow,'');assert.equal(document.activeElement,ball);
  }finally{
    await act(async()=>root.unmount());container.remove();HTMLElement.prototype.getClientRects=oldRects;HTMLElement.prototype.setPointerCapture=oldCapture;globals.IS_REACT_ACT_ENVIRONMENT=previousAct;if(previousStorage)Object.defineProperty(globalThis,'localStorage',previousStorage);else Reflect.deleteProperty(globalThis,'localStorage');await setup.close();
  }
});


import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement,createRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {EditorView} from '@codemirror/view';
import {undo} from '@codemirror/commands';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {createTestEditor} from './helpers/visual-editor';
import {PageEditor,type PageEditorHandle} from '../src/components/page-editor';
import {PageSettings} from '../src/components/page-settings';
import {ColorPicker} from '../src/components/color-picker';
import {ReaderLayout,MarkdownBody} from '../src/components/reader';
import {defaultSettings} from '../src/lib/model';
import type {PageDocument} from '../src/lib/editor-draft-model';

async function harness(){
  const setup=await createTestEditor({views:true}),container=document.createElement('div');document.body.append(container);const root=createRoot(container),globals=globalThis as any,previous=new Map<string,PropertyDescriptor|undefined>();
  class Observer {observe(){}unobserve(){}disconnect(){}}
  for(const [name,value]of Object.entries({ResizeObserver:Observer,IntersectionObserver:Observer,IS_REACT_ACT_ENVIRONMENT:true,Window:window.Window,self:window})){previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globals,name,{configurable:true,writable:true,value});}
  (window as any).ResizeObserver=Observer;(window.HTMLElement.prototype as any).attachEvent=()=>{};(window.HTMLElement.prototype as any).detachEvent=()=>{};window.scrollBy=()=>{};window.HTMLElement.prototype.scrollIntoView=()=>{};
  return {container,root,async close(){await act(async()=>root.unmount());container.remove();for(const [key,value]of previous)if(value)Object.defineProperty(globals,key,value);else delete globals[key];await setup.close();}};
}
test('page tabs retain editor instances, selection, history and insertion target, with minimal settings',async()=>{
  const h=await harness(),ref=createRef<PageEditorHandle>();let latest:PageDocument;
  function Harness(){const [doc,setDoc]=useState<PageDocument>({id:'page',title:'页面',kind:'page',contentFormat:'html',body:'<h1>标题</h1>',css:'h1{color:red}',route:'/example',folderId:'root'});latest=doc;return createElement(PageEditor,{ref,doc,preview:'<h1>预览</h1>',previewCss:'',previewClass:'',previewError:'',onChange:patch=>setDoc(value=>({...value,...patch})),onUpload:()=>{},folders:[{id:'root',name:'根目录',path:'',parentId:'',access:'inherit',order:0}]});}
  try{await act(async()=>h.root.render(createElement(Harness)));const editors=h.container.querySelectorAll<HTMLElement>('.cm-editor');assert.equal(editors.length,2);const html=EditorView.findFromDOM(editors[0])!,css=EditorView.findFromDOM(editors[1])!;
    await act(async()=>{html.dispatch({selection:{anchor:4}});ref.current!.rememberSelection();h.container.querySelectorAll<HTMLButtonElement>('[role=tab]')[1].click();css.dispatch({changes:{from:0,insert:'/* edit */'}});});
    assert.match(latest!.css!,/edit/);await act(async()=>ref.current!.insert('<img src="/example.png">'));assert.equal(h.container.querySelector('[role=tab][aria-selected=true]')?.textContent,'HTML');assert.match(latest!.body,/<h1><img/);assert.equal(EditorView.findFromDOM(editors[0]),html);assert.equal(EditorView.findFromDOM(editors[1]),css);
    await act(async()=>{undo(html);});assert.equal(latest!.body,'<h1>标题</h1>');
    await act(async()=>{h.container.querySelector<HTMLButtonElement>('[aria-label="插入动态内容"]')!.click();});assert.deepEqual(Array.from(h.container.querySelectorAll('[role=menuitem]')).map(item=>item.textContent),['首页文章列表','归档目录','文章集合','链接卡片']);
    await act(async()=>h.root.render(createElement(PageSettings,{doc:latest!,onChange:()=>{}})));const text=h.container.textContent!;assert.match(text,/页面地址|访问权限|旧地址别名/);assert.doesNotMatch(text,/摘要|封面|首页置顶|排序权重|集合每页/);
  }finally{await h.close();}
});
test('reader starts from screen width on each article and only resets manual choices at breakpoint changes',async()=>{
  const h=await harness(),listeners=new Set<()=>void>();let wide=true;
  window.matchMedia=()=>({get matches(){return wide;},addEventListener:(_name:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_name:string,fn:()=>void)=>listeners.delete(fn)}) as any;
  const render=(id:string)=>createElement(ReaderLayout,{headings:[],categoryName:'同类',articles:[],currentArticleId:id,settings:defaultSettings,children:createElement('p',null,'正文')});
  try{await act(async()=>h.root.render(render('one')));const toggle=()=>h.container.querySelector<HTMLButtonElement>('.reader-toggle')!;assert.equal(toggle().getAttribute('aria-expanded'),'true');await act(async()=>toggle().click());assert.equal(toggle().getAttribute('aria-expanded'),'false');await act(async()=>h.root.render(render('two')));assert.equal(toggle().getAttribute('aria-expanded'),'true');await act(async()=>{wide=false;listeners.forEach(fn=>fn());});assert.equal(toggle().getAttribute('aria-expanded'),'false');await act(async()=>toggle().click());assert.equal(document.body.style.overflow,'hidden');await act(async()=>{wide=true;listeners.forEach(fn=>fn());});assert.equal(document.body.style.overflow,'');assert.equal(toggle().getAttribute('aria-expanded'),'true');}finally{await h.close();}
});
test('archive ordinary clicks use client navigation while modified clicks and tree state survive updates',async()=>{
  const h=await harness(),calls:unknown[][]=[],router={push:(...args:unknown[])=>calls.push(args),prefetch:()=>{},replace:()=>{},refresh:()=>{},back:()=>{},forward:()=>{}} as any;
  const html=(current:string)=>`<div data-archive-root><nav class="knowledge-tree"><details open data-folder-id="one"><summary>目录</summary><a data-archive-nav href="/knowledge?folder=one">分类</a></details><a class="tree-root active" data-archive-nav href="/knowledge?folder=${current}">根</a></nav></div>`;
  const render=(current:string)=>createElement(AppRouterContext.Provider,{value:router},createElement(MarkdownBody,{html:html(current),archiveNavigation:true}));
  try{await act(async()=>h.root.render(render('root')));const tree=h.container.querySelector<HTMLElement>('.knowledge-tree')!,branch=h.container.querySelector<HTMLDetailsElement>('details')!;branch.open=false;await act(async()=>branch.dispatchEvent(new Event('toggle',{bubbles:false})));tree.scrollTop=73;tree.dispatchEvent(new Event('scroll'));
    const link=h.container.querySelector<HTMLAnchorElement>('.tree-root')!;const modified=new window.MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true});await act(async()=>link.dispatchEvent(modified));assert.equal(modified.defaultPrevented,false);assert.equal(calls.length,0);
    await act(async()=>link.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true})));assert.deepEqual(calls,[['/knowledge?folder=root',{scroll:false}]]);await act(async()=>h.root.render(render('one')));assert.equal(h.container.querySelector<HTMLDetailsElement>('details')!.open,false);assert.equal(h.container.querySelector<HTMLElement>('.knowledge-tree')!.scrollTop,73);
  }finally{await h.close();}
});
test('custom colors in a floating selection toolbar allow input focus and commit once',async()=>{
  const h=await harness(),applied:string[]=[],remembered:string[]=[];
  try{await act(async()=>h.root.render(createElement('div',{onMouseDown:(event:any)=>event.preventDefault()},createElement(ColorPicker,{field:'color',onRemember:()=>remembered.push('selection'),onApply:(_field,value)=>applied.push(value)}))));await act(async()=>h.container.querySelector<HTMLButtonElement>('button')!.click());
    const input=document.querySelector<HTMLInputElement>('[aria-label="自定义文字颜色 HEX"]')!,event=new window.MouseEvent('mousedown',{bubbles:true,cancelable:true});input.dispatchEvent(event);assert.equal(event.defaultPrevented,false);input.focus();assert.equal(document.activeElement,input);await act(async()=>Array.from(document.querySelectorAll<HTMLButtonElement>('.inline-color-picker button')).find(button=>button.textContent==='应用')!.click());assert.deepEqual(remembered,['selection']);assert.deepEqual(applied,['#3478ce']);assert.equal(document.querySelector('.inline-color-picker'),null);
  }finally{await h.close();}
});

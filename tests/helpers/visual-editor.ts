import {JSDOM} from 'jsdom';
import {Editor,rootCtx,defaultValueCtx} from '@milkdown/kit/core';
import {commonmark} from '@milkdown/kit/preset/commonmark';
import {gfm} from '@milkdown/kit/preset/gfm';
import {visualSyntax,configureCodeSchema} from '../../src/lib/visual-schema';
import {visualNodeViews} from '../../src/components/visual-nodeviews';
import {$prose} from '@milkdown/kit/utils';
import {visualTabsPlugin} from '../../src/lib/visual-blocks';
import {history} from '@milkdown/kit/plugin/history';
import {configureLiveMarkdown,liveCommonmark,liveGfm,liveSyntax,liveMarkdownPlugin} from '../../src/lib/live-markdown';
/** Markdown moves edge whitespace outside emphasis; compare that visually neutral form. */
export function equivalentVisualDocuments(a:any,b:any){
  if(a.textContent!==b.textContent)return false;
  function normalized(node:any):any{
    if(!node.content)return node;
    const content:any[]=[];
    const push=(item:any)=>{if(item.marks?.length===0)delete item.marks;const last=content.at(-1);if(last?.type==='text'&&item.type==='text'&&JSON.stringify(last.marks||[])===JSON.stringify(item.marks||[]))last.text+=item.text;else content.push(item);};
    for(const child of node.content){
      const n=normalized(child);
      if(n.type==='text'&&n.marks?.some((m:any)=>['strong','emphasis','strike_through'].includes(m.type))){
        const match=n.text.match(/^(\s*)([\s\S]*?)(\s*)$/);const plain={...n,marks:n.marks.filter((m:any)=>!['strong','emphasis','strike_through'].includes(m.type))};
        if(match[1])push({...plain,text:match[1]});if(match[2])push({...n,text:match[2]});if(match[3])push({...plain,text:match[3]});
      }else push(n);
    }
    return {...node,content};
  }
  return JSON.stringify(normalized(a.toJSON()))===JSON.stringify(normalized(b.toJSON()));
}
export async function createTestEditor(options:{views?:boolean;live?:boolean}={}){
  const dom=new JSDOM('<!doctype html><html><body><div id="editor"></div></body></html>',{pretendToBeVisual:true,url:'http://localhost'});
  const previous=new Map<string,PropertyDescriptor|undefined>();
  const bound=['getComputedStyle','requestAnimationFrame','cancelAnimationFrame','addEventListener','removeEventListener','dispatchEvent'];
  for(const key of ['window','document','Node','Text','Element','HTMLElement','DocumentFragment','MutationObserver','navigator','DOMParser','Event','CustomEvent','KeyboardEvent','DOMException',...bound]){
    previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));const value=(dom.window as any)[key];Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:typeof value==='function'&&bound.includes(key)?value.bind(dom.window):value});
  }
  if(options.views){
    dom.window.Range.prototype.getClientRects=()=>[] as unknown as DOMRectList;
    dom.window.Range.prototype.getBoundingClientRect=()=>new dom.window.DOMRect();
  }
  const builder=Editor.make().config(ctx=>{ctx.set(rootCtx,dom.window.document.querySelector('#editor'));ctx.set(defaultValueCtx,'');configureCodeSchema(ctx);if(options.live)configureLiveMarkdown(ctx);}).use(options.live?liveCommonmark:commonmark).use(options.live?liveGfm:gfm).use(visualSyntax);
  if(options.live)builder.use(liveSyntax).use($prose(()=>liveMarkdownPlugin()));
  if(options.views)builder.use(history).use($prose(()=>visualTabsPlugin())).use(visualNodeViews());
  const editor=await builder.create();
  return {editor,close:async()=>{await editor.destroy();dom.window.close();for(const [key,value]of previous)if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}};
}


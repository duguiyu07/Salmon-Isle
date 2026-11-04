import { $node, $remark } from '@milkdown/kit/utils';
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { codeBlockSchema,imageSchema } from '@milkdown/kit/preset/commonmark';
import directive from 'remark-directive';
import math from 'remark-math';
import cjk from 'remark-cjk-friendly/parseOnly';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { blockStyle, cleanInlineStyle, groupClasses } from './styles';
import { isHtmlBlock } from './html-block';
import { schemaCtx,remarkCtx } from '@milkdown/kit/core';
import { ParserState,SerializerState } from '@milkdown/kit/transformer';
import {remarkImageCaptions} from './image-caption';
import {inlineColors,inlineColorStyle} from './inline-color';
export const parseVisualMarkdown=(ctx:any,source:string)=>ParserState.create(ctx.get(schemaCtx),ctx.get(remarkCtx))(source);
export const serializeVisualMarkdown=(ctx:any,doc:any)=>SerializerState.create(ctx.get(schemaCtx),ctx.get(remarkCtx))(doc);

export const containerNames=['group','details','tabs','tab','columns','column','gallery'] as const;
const stringify=unified().use(remarkStringify).use(directive).use(math);
export const directivePlugin=$remark('salmon-directive',()=>directive);
export const mathPlugin=$remark('salmon-math',()=>math);
export const cjkPlugin=$remark('salmon-cjk',()=>cjk);
export const imageCaptionPlugin=$remark('salmon-image-captions',()=>remarkImageCaptions as any);
function pastedAttributes(value:string){try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?Object.fromEntries(Object.entries(parsed).filter(([,v])=>typeof v==='string')):{};}catch{return{};}}

function htmlSpans(this:any) {
  const data=this.data();const extensions=data.toMarkdownExtensions||[];data.toMarkdownExtensions=extensions;
  extensions.push({handlers:{styledSpan(node:any,_parent:any,state:any,info:any){const style=cleanInlineStyle(node.style||'');return `<${node.tag}${style?` style="${style}"`:''}>${state.containerPhrasing(node,info)}</${node.tag}>`;}}});
  return (tree:any)=>{
    visit(tree,(parent:any)=>{
      if(!parent.children)return;
      const children=parent.children;
      for(let i=0;i<children.length;i++){
        const n=children[i];if(n.type!=='html')continue;
        const match=String(n.value).match(/^<(mark|span|sup|sub|u|code|strong|b|em|i|s)(?:\s+[^>]*)?>$/i);if(!match)continue;
        let depth=1,end=i+1;for(;end<children.length;end++){const c=children[end];if(c.type!=='html')continue;if(new RegExp(`^<${match[1]}(?:\\s[^>]*)?>$`,'i').test(c.value))depth++;if(new RegExp(`^</${match[1]}>$`,'i').test(c.value)&&!--depth)break;}
        if(end===children.length)continue;
        const style=n.value.match(/style\s*=\s*"([^"]*)"/i)?.[1]||'';
        children.splice(i,end-i+1,{type:'styledSpan',tag:match[1].toLowerCase(),style:cleanInlineStyle(style),children:children.slice(i+1,end),position:n.position&&children[end].position?{start:n.position.start,end:children[end].position.end}:undefined});
      }
    });
    visit(tree,(node:any,_index:any,parent:any)=>{
      if(node.type==='containerDirective'&&!containerNames.includes(node.name)){node.value=stringify.stringify({type:'root',children:[structuredClone(node)]});node.type='rawBlock';delete node.children;}
      else if(node.type==='leafDirective'&&node.name!=='embed'){node.value=stringify.stringify({type:'root',children:[structuredClone(node)]});node.type='rawBlock';}
      else if(node.type==='textDirective'&&!['spoiler','text'].includes(node.name)){
        const literal=stringify.stringify({type:'root',children:[{type:'paragraph',children:[structuredClone(node)]}]}).trim();
        if(!node.children?.length&&!Object.keys(node.attributes||{}).length){node.type='text';node.value=literal;delete node.children;}
        else{node.type='rawInline';node.value=literal;delete node.children;}
      }
      else if(node.type==='html'&&!['paragraph','heading','tableCell','styledSpan','textDirective'].includes(parent?.type)){
        if(/^<br\s*\/?>(?:\n)?$/i.test(node.value.trim())){node.type='paragraph';node.children=[];delete node.value;}
        else node.type='rawBlock';
      }
    });
  };
}
export const inlineHtmlPlugin=$remark('salmon-html',()=>htmlSpans as any);

export const containerNodes=containerNames.map(name=>$node(`salmon_${name}`,()=>({
  group:'block',content:'block+',defining:true,isolating:true,attrs:{attributes:{default:{}}},
  parseDOM:[{tag:`div[data-salmon-container="${name}"]`,getAttrs:(dom:any)=>({attributes:pastedAttributes(dom.dataset.attributes||'{}')})}],
  toDOM:node=>['div',{'data-salmon-container':name,'data-attributes':JSON.stringify(node.attrs.attributes),class:containerClass(name,node.attrs.attributes),style:blockStyle(node.attrs.attributes)},0],
  parseMarkdown:{match:node=>node.type==='containerDirective'&&node.name===name,runner:(state,node,type)=>{state.openNode(type,{attributes:node.attributes||{}});if((node.children as any[])?.length)state.next(node.children as any);else state.addNode(state.schema.nodes.paragraph);state.closeNode();}},
  toMarkdown:{match:node=>node.type.name===`salmon_${name}`,runner:(state,node)=>{state.openNode('containerDirective',undefined,{name,attributes:node.attrs.attributes});state.next(node.content);state.closeNode();}},
})));
export function containerClass(name:string,attrs:Record<string,string>){
  if(name==='group')return groupClasses(attrs).join(' ');
  return `content-${name==='tab'?'tab':name==='column'?'column':name}`;
}
export const mathNodes=['inlineMath','math'].map(kind=>$node(kind==='math'?'salmon_math':'salmon_inline_math',()=>({
  group:kind==='math'?'block':'inline',inline:kind!=='math',atom:true,selectable:true,attrs:{value:{default:''}},
  parseDOM:[{tag:`${kind==='math'?'div':'span'}[data-salmon-math]`,getAttrs:(dom:any)=>({value:dom.dataset.salmonMath||''})}],
  toDOM:node=>[kind==='math'?'div':'span',{'data-salmon-math':node.attrs.value},node.attrs.value],
  parseMarkdown:{match:node=>node.type===kind,runner:(state,node,type)=>{state.addNode(type,{value:node.value});}},
  toMarkdown:{match:node=>node.type.name===(kind==='math'?'salmon_math':'salmon_inline_math'),runner:(state,node)=>{state.addNode(kind,undefined,node.attrs.value);}},
})));
export const styledSpanNode=$node('salmon_styled_span',()=>({
  group:'inline',inline:true,content:'inline*',attrs:{tag:{default:'span'},style:{default:''}},
  parseDOM:[{tag:'span[data-salmon-style]',getAttrs:(dom:any)=>({tag:/^(mark|span|sup|sub|u|code|strong|b|em|i|s)$/.test(dom.dataset.tag||'')?dom.dataset.tag:'span',style:cleanInlineStyle(dom.getAttribute('style')||'')})}],
  toDOM:node=>[node.attrs.tag,{'data-salmon-style':'true','data-tag':node.attrs.tag,style:cleanInlineStyle(node.attrs.style)},0],
  parseMarkdown:{match:node=>node.type==='styledSpan',runner:(state,node,type)=>{state.openNode(type,{tag:node.tag,style:node.style});state.next(node.children as any);state.closeNode();}},
  toMarkdown:{match:node=>node.type.name==='salmon_styled_span',runner:(state,node)=>{state.openNode('styledSpan',undefined,{tag:node.attrs.tag,style:node.attrs.style});state.next(node.content);state.closeNode();}},
}));
export const coloredTextNode=$node('salmon_colored_text',()=>({
  group:'inline',inline:true,content:'inline*',attrs:{colors:{default:{}}},
  parseDOM:[{tag:'span[data-text-color],span[data-text-background]',getAttrs:(dom:HTMLElement)=>({colors:inlineColors({color:dom.dataset.textColor,background:dom.dataset.textBackground})})}],
  toDOM:node=>['span',{class:'inline-colored-text',style:inlineColorStyle(node.attrs.colors),'data-text-color':node.attrs.colors.color,'data-text-background':node.attrs.colors.background},0],
  parseMarkdown:{match:node=>node.type==='textDirective'&&node.name==='text',runner:(state,node,type)=>{state.openNode(type,{colors:inlineColors((node.attributes||{}) as Record<string,unknown>)});state.next(node.children as any);state.closeNode();}},
  toMarkdown:{match:node=>node.type.name==='salmon_colored_text',runner:(state,node)=>{state.openNode('textDirective',undefined,{name:'text',attributes:node.attrs.colors});state.next(node.content);state.closeNode();}},
}));
export const spoilerNode=$node('salmon_spoiler',()=>({
  group:'inline',inline:true,content:'inline*',
  parseDOM:[{tag:'span.spoiler'}],toDOM:()=>['span',{class:'spoiler editor-spoiler'},0],
  parseMarkdown:{match:node=>node.type==='textDirective'&&node.name==='spoiler',runner:(state,node,type)=>{state.openNode(type);state.next(node.children as any);state.closeNode();}},
  toMarkdown:{match:node=>node.type.name==='salmon_spoiler',runner:(state,node)=>{state.openNode('textDirective',undefined,{name:'spoiler',attributes:{}});state.next(node.content);state.closeNode();}},
}));
export const rawBlockNode=$node('salmon_raw_block',()=>({
  group:'block',atom:true,attrs:{value:{default:''}},
  parseDOM:[{tag:'div[data-salmon-raw]',getAttrs:(dom:any)=>({value:dom.dataset.salmonRaw||''})}],
  toDOM:node=>['div',{'data-salmon-raw':node.attrs.value},node.attrs.value],
  parseMarkdown:{match:node=>node.type==='rawBlock'||(node.type==='leafDirective'&&node.name==='embed'),runner:(state,node,type)=>{state.addNode(type,{value:node.value||stringify.stringify({type:'root',children:[node as any]})});}},
  toMarkdown:{match:node=>node.type.name==='salmon_raw_block',runner:(state,node)=>{state.addNode('html',undefined,node.attrs.value);}},
}));
export const htmlBlockNode=$node('salmon_html',()=>({
  group:'block',atom:true,selectable:true,attrs:{value:{default:''}},
  parseDOM:[{tag:'div[data-salmon-html]',getAttrs:(dom:any)=>({value:dom.dataset.salmonHtml||''})}],
  toDOM:node=>['div',{'data-salmon-html':node.attrs.value},node.attrs.value],
  parseMarkdown:{match:node=>node.type==='code'&&isHtmlBlock(node as any),runner:(state,node,type)=>{state.addNode(type,{value:node.value||''});}},
  toMarkdown:{match:node=>node.type.name==='salmon_html',runner:(state,node)=>{state.addNode('code',undefined,node.attrs.value,{lang:'html',meta:'render'});}},
}));
export const rawInlineNode=$node('salmon_raw_inline',()=>({
  group:'inline',inline:true,atom:true,attrs:{value:{default:''}},
  parseDOM:[{tag:'span[data-salmon-raw-inline]',getAttrs:(dom:any)=>({value:dom.dataset.salmonRawInline||''})}],
  toDOM:node=>['span',{'data-salmon-raw-inline':node.attrs.value,class:'visual-raw-inline'},node.attrs.value],
  parseMarkdown:{match:node=>node.type==='rawInline',runner:(state,node,type)=>{state.addNode(type,{value:node.value});}},
  toMarkdown:{match:node=>node.type.name==='salmon_raw_inline',runner:(state,node)=>{state.addNode('html',undefined,node.attrs.value);}},
}));
/** Extend the existing schema so normal code input rules still work. */
export function configureCodeSchema(ctx:any){
ctx.update(imageSchema.key,(previous:any)=>(context:any)=>{
  const base=previous(context);
  return {...base,attrs:{...base.attrs,caption:{default:''},figureAttributes:{default:{}}},
    parseDOM:[{tag:'span[data-salmon-image]',getAttrs:(dom:HTMLElement)=>{const img=dom.querySelector('img')!;return {src:img.getAttribute('src')||'',alt:img.getAttribute('alt')||'',title:img.getAttribute('title')||'',caption:dom.dataset.caption||'',figureAttributes:pastedAttributes(dom.dataset.figureAttributes||'{}')};}},...base.parseDOM],
    toDOM:(node:any)=>node.attrs.caption||Object.keys(node.attrs.figureAttributes).length?['span',{'data-salmon-image':'true','data-caption':node.attrs.caption,'data-figure-attributes':JSON.stringify(node.attrs.figureAttributes)},['img',{src:node.attrs.src,alt:node.attrs.alt,title:node.attrs.title}],['span',{class:'content-image-caption'},node.attrs.caption]]:['img',{src:node.attrs.src,alt:node.attrs.alt,title:node.attrs.title}],
    parseMarkdown:{match:(node:any)=>node.type==='image',runner:(state:any,node:any,type:any)=>state.addNode(type,{src:node.url,alt:node.alt||'',title:node.title||'',caption:node.caption||'',figureAttributes:node.figureAttributes||{}})},
    toMarkdown:{match:(node:any)=>node.type.name==='image',runner:(state:any,node:any)=>state.addNode(node.attrs.caption||Object.keys(node.attrs.figureAttributes).length?'captionedImage':'image',undefined,undefined,{url:node.attrs.src,alt:node.attrs.alt,title:node.attrs.title,caption:node.attrs.caption,figureAttributes:node.attrs.figureAttributes})},
  };
});
ctx.update(codeBlockSchema.key,(previous:any)=>(context:any)=>{
  const base=previous(context);return {...base,attrs:{...base.attrs,meta:{default:''}},
    parseMarkdown:{match:(node:any)=>node.type==='code'&&!isHtmlBlock(node),runner:(state:any,node:any,type:any)=>{state.openNode(type,{language:node.lang||'',meta:node.meta||''});if(node.value)state.addText(node.value);state.closeNode();}},
    toMarkdown:{match:(node:any)=>node.type.name==='code_block',runner:(state:any,node:any)=>state.addNode('code',undefined,node.textContent,{lang:node.attrs.language,meta:node.attrs.meta})},
  };
});}
export const visualSyntax:MilkdownPlugin[]=[...directivePlugin,...mathPlugin,...cjkPlugin,...imageCaptionPlugin,...inlineHtmlPlugin,...containerNodes,...mathNodes,styledSpanNode,coloredTextNode,spoilerNode,htmlBlockNode,rawBlockNode,rawInlineNode];

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import rehypeKatex from 'rehype-katex';
import rehypePrettyCode from 'rehype-pretty-code';
import { visit } from 'unist-util-visit';
import { blockStyle, cleanInlineStyle, groupClasses, groupBasePreset, shortcutHref } from './styles';
import { isHtmlBlock } from './html-block';
import { codeLanguage } from './code-languages';
import { parseCodeMeta, lineRange, CodeOptions } from './code-block';
import {remarkImageCaptions,renderImageCaptions} from './image-caption';
import {inlineColors,inlineColorStyle} from './inline-color';
import {createHash} from 'node:crypto';
import {RenderCache} from './render-cache';
export interface Heading { id: string; text: string; depth: number }

function directives() {
  return (tree: any,file:any) => visit(tree,(node: any,_index:any,parent:any) => {
    node.inlineColorContext={...parent?.inlineColorContext,...(node.type==='textDirective'&&node.name==='text'?inlineColors(node.attributes||{}):{})};
    if (node.type !== 'containerDirective' && node.type !== 'leafDirective' && node.type !== 'textDirective') return;
    if(node.type==='textDirective'&&!['spoiler','text'].includes(node.name)){
      node.type='text';node.value=String(file.value).slice(node.position.start.offset,node.position.end.offset);delete node.children;return;
    }
    const a = node.attributes || {}; const data = node.data ||= {}; const style = blockStyle(a);
    const props: Record<string,unknown> = { ...(style ? {style} : {}) };
    if(node.type==='textDirective'&&node.name==='text'){
      const colors=inlineColors(a);data.hName='span';props.className=['inline-colored-text'];props.style=inlineColorStyle(node.inlineColorContext);
      if(colors.color)props.dataTextColor=colors.color;if(colors.background)props.dataTextBackground=colors.background;
    } else if (node.name === 'group') {
      data.hName = 'div'; props.className = groupClasses(a);
      if(groupBasePreset(a)==='shortcut'&&shortcutHref(a.href))props.dataShortcutHref=shortcutHref(a.href);
    } else if (node.name === 'details') {
      data.hName = 'details'; props.className = ['content-details']; if (a.open === 'true') props.open = true;
      node.children.unshift({ type:'paragraph',data:{hName:'summary'},children:[{type:'text',value:a.title||'展开查看详细信息'}] });
    } else if (node.name === 'tabs') { data.hName='div';props.className=['content-tabs']; }
    else if (node.name === 'tab') { data.hName='section';props.className=['content-tab'];props['data-tab-title']=String(a.title || '标签页'); }
    else if (node.name === 'columns') { data.hName='div';props.className=['content-columns']; }
    else if (node.name === 'column') { data.hName='div';props.className=['content-column']; }
    else if (node.name === 'gallery') { data.hName='div';props.className=['content-gallery']; }
    else if (node.name === 'figure') {
      data.hName='figure';props.className=['content-figure'];
      const [image,...caption]=node.children||[];
      if(image?.type==='paragraph'&&image.children?.length===1&&(image.children[0].type==='image'||image.children[0].type==='link'&&image.children[0].children?.[0]?.type==='image')) {
        node.children=[...image.children,...(caption.length?[{type:'blockquote',data:{hName:'figcaption'},children:caption}]:[])];
      }
    }
    else if (node.name === 'spoiler') { data.hName='span';props.className=['spoiler']; props.tabIndex=0; }
    else if (node.name === 'embed' && /^https:\/\/(music\.163\.com|www\.youtube\.com|player\.bilibili\.com)\//.test(a.src || '')) {
      data.hName='a'; props.href=a.src; props.className=['embed-link']; node.children=[{type:'text',value:a.title||'打开嵌入内容 ↗'}];
    } else { data.hName='div';props.className=['unsupported-block']; }
    data.hProperties=props;
  });
}
function cleanStyles() { return (tree:any) => visit(tree,'element',(node:any)=> {
  if (node.properties?.style) { const safe=cleanInlineStyle(String(node.properties.style)); if(safe) node.properties.style=safe; else delete node.properties.style; }
  // Never allow content-controlled tab state, handlers, forms or remote scripts.
}); }
// Promote cards after raw HTML is parsed and sanitized, so child links cannot
// close the outer card or leave nested anchors in the rendered document.
function shortcutCards(){return (tree:any)=>{
  visit(tree,'element',(node:any)=>{
    const href=shortcutHref(node.properties?.dataShortcutHref);
    if(href){node.tagName='a';node.properties.href=href;}
    if(node.properties)delete node.properties.dataShortcutHref;
  });
  const unwrap=(node:any)=>{node.children=(node.children||[]).flatMap((child:any)=>{
    if(child.type!=='element')return [child];
    unwrap(child);return child.tagName==='a'?child.children:[child];
  });};
  visit(tree,'element',(node:any)=>{if(node.tagName==='a'&&node.properties.className?.includes('shortcut-card'))unwrap(node);});
};}
const schema: any = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []),'details','summary','section','mark','figure','figcaption'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []),'style'],
    div: ['className','style','dataShortcutHref'], section:['className','style','dataTabTitle'],
    details:['className','open','style'], summary:['className','style'],
    span:['className','style','tabIndex','dataTextColor','dataTextBackground'], mark:['style'],
    code:[...(defaultSchema.attributes?.code || []),'dataCodeMeta',['className',/^language-/,/^math-/]],
    a:[...(defaultSchema.attributes?.a || []),'className'],
    img:[...(defaultSchema.attributes?.img || []),'width','height','loading'], figure:['className','style']
  },
  protocols: { ...defaultSchema.protocols, src:['http','https'], href:['http','https','mailto'] }
};
type RenderedMarkdown={html:string;headings:Heading[]};
const renderedMarkdown=new RenderCache<RenderedMarkdown>();
export function renderMarkdown(markdown:string,options:{pageTitle?:boolean}={}):Promise<RenderedMarkdown>{
  const key=String(!!options.pageTitle)+':'+createHash('sha256').update(markdown).digest('hex');
  return renderedMarkdown.get(key,()=>renderUncachedMarkdown(markdown,options),value=>Buffer.byteLength(value.html)+Buffer.byteLength(JSON.stringify(value.headings)));
}
async function renderUncachedMarkdown(markdown: string, options: {pageTitle?:boolean}): Promise<RenderedMarkdown> {
  const headings: Heading[]=[]; const ids=new Map<string,number>();
  const codeBlocks: {options:CodeOptions;source:string}[]=[];
  const processor: any = unified();
  const result = await processor.use(remarkParse).use(remarkCjkFriendly).use(remarkGfm).use(remarkMath).use(remarkDirective).use(remarkImageCaptions).use(renderImageCaptions).use(directives)
    .use(()=>(tree:any)=>visit(tree,'code',(node:any)=>{if(isHtmlBlock(node)){node.type='html';delete node.lang;delete node.meta;}}))
    .use(()=>(tree:any)=>visit(tree,'code',(node:any)=>{if(node.meta){node.data||={};node.data.hProperties||={};node.data.hProperties.dataCodeMeta=node.meta;}}))
    .use(remarkRehype,{ allowDangerousHtml:true }).use(rehypeRaw).use(cleanStyles).use(rehypeSanitize,schema).use(shortcutCards)
    .use(() => (tree:any) => {
      visit(tree,'element',(node:any)=> {
        if (/^h[1-6]$/.test(node.tagName)) {
          const texts:string[]=[];visit(node,'text',(n:any)=>{texts.push(n.value);}); const text=texts.join('');
          const base=text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu,'').trim().replace(/\s+/g,'-') || 'section';
          const count=ids.get(base)||0;ids.set(base,count+1);const id=count?`${base}-${count}`:base;
          node.properties.id=id;
          if(options.pageTitle&&node.tagName==='h1'&&!headings.some(h=>h.depth===1))node.properties.className=['page-title'];
          headings.push({id,text,depth:Number(node.tagName[1])});
        }
        if (node.tagName==='a' && /^https?:/.test(String(node.properties.href))) {node.properties.target='_blank';node.properties.rel=['noopener','noreferrer'];}
        if(node.tagName==='code'&&Array.isArray(node.properties.className))node.properties.className=node.properties.className.map((name:string)=>name.startsWith('language-')&&name!=='language-math'?`language-${codeLanguage(name.slice(9))}`:name);
        if (node.tagName==='img') {node.properties.loading='lazy';node.properties.decoding='async';}
      });
    })
    .use(rehypeKatex,{ strict:false,trust:false,throwOnError:false })
    .use(()=>(tree:any)=>visit(tree,'element',(node:any)=>{
      if(node.tagName!=='pre')return;const code=node.children.find((n:any)=>n.tagName==='code');if(!code)return;
      const texts:string[]=[];visit(code,'text',(n:any)=>texts.push(n.value));
      codeBlocks.push({options:parseCodeMeta(code.properties.dataCodeMeta||code.data?.meta||''),source:texts.join('').replace(/\n$/,'')});delete code.properties.dataCodeMeta;
      if(code.data?.meta)code.data.meta=code.data.meta.replace(/(?:^|\s)(?:lineNumbers|start|highlight|blur)=(?:"[^"]*"|'[^']*'|\S+)/g,'').trim();
    }))
    .use(rehypePrettyCode,{ theme:{light:'github-light',dark:'github-dark'},keepBackground:false,defaultLang:'plaintext' })
    .use(()=>(tree:any)=>{let index=0;visit(tree,'element',(node:any)=>{
      if(node.tagName!=='pre')return;const block=codeBlocks[index++];if(!block)return;
      const code=node.children.find((n:any)=>n.tagName==='code');if(!code)return;
      const lines=code.children.filter((n:any)=>n.properties&&Object.hasOwn(n.properties,'data-line'));
      const highlight=lineRange(block.options.highlight,block.options.start,lines.length),blur=lineRange(block.options.blur,block.options.start,lines.length);
      node.properties['data-code-source']=encodeURIComponent(block.source);
      code.properties['data-code-lines']=block.options.lineNumbers?'true':'false';
      lines.forEach((line:any,i:number)=>{const number=block.options.start+i;line.properties['data-line-number']=String(number);
        if(highlight.has(number))line.properties['data-highlighted-line']='';
        if(blur.has(number))line.properties['data-blurred-line']='';
        line.children=[{type:'element',tagName:'span',properties:{className:['code-line-text']},children:line.children}];
      });
    });})
    .use(rehypeStringify).process(markdown);
  return { html:String(result),headings };
}

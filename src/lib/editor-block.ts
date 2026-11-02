import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import { visit } from 'unist-util-visit';
import { parseCodeMeta } from './code-block';
import { isHtmlBlock } from './html-block';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import {remarkImageCaptions} from './image-caption';
const parser=unified().use(remarkParse).use(remarkCjkFriendly).use(remarkDirective).use(remarkMath).use(remarkGfm).use(remarkImageCaptions);
export interface SelectedBlock {index:number;fence:string;name:string;attrs:Record<string,string>;from?:number;to?:number}
export function blockAtLine(body:string,line:number):SelectedBlock|null{
  const tree=parser.runSync(parser.parse(body),{value:body});const lines=body.split('\n');let selected:SelectedBlock|null=null;
  visit(tree,(node:any,_index:any,parent:any)=>{
    if(!node.position||node.position.start.line>line||node.position.end.line<line)return;
    const index=node.position.start.line-1;
    const range={from:node.position.start.offset,to:node.position.end.offset};
    if(node.type==='containerDirective'&&!(node.name==='tab'&&selected?.name==='tabs')){const fence=lines[index].match(/^:+/)?.[0];if(fence)selected={index,fence,name:node.name,attrs:node.attributes||{},...range};}
    if(node.type==='code'){const fence=lines[index].match(/^\s*(`{3,}|~{3,})/)?.[1];const o=parseCodeMeta(node.meta||'');if(fence)selected=isHtmlBlock(node)?{index,fence,name:'html',attrs:{value:node.value||''},...range}:{index,fence,name:'code',attrs:{language:node.lang||'text',lineNumbers:String(o.lineNumbers),start:String(o.start),highlight:o.highlight,blur:o.blur},...range};}
    if(node.type==='image'){
      const imageRange=parent?.type==='link'&&parent.position.start.offset<=range.from&&parent.position.end.offset>=range.to?{from:parent.position.start.offset,to:parent.position.end.offset}:range;
      selected={index,fence:'',name:'image',attrs:{src:node.url,alt:node.alt||'',title:node.title||'',caption:node.caption||'',...node.figureAttributes,...(parent?.type==='link'?{linkHref:parent.url,linkTitle:parent.title||''}:{})},...imageRange};
    }
  });return selected;
}
export function sourceInsertionLine(body:string,line:number){
  if((body.split('\n')[line-1]??'x').trim())return false;
  let allowed=true;visit(parser.parse(body),(node:any)=>{if(node.position?.start.line<=line&&node.position.end.line>=line&&['code','math','table','html'].includes(node.type))allowed=false;});return allowed;
}

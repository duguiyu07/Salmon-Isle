import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import {remarkImageCaptions,figureImage,captionedParagraphMarkdown} from './image-caption';

const parser=unified().use(remarkParse).use(remarkCjkFriendly).use(remarkGfm).use(remarkMath).use(remarkDirective).use(remarkImageCaptions);
const parse=(source:string)=>parser.runSync(parser.parse(source),{value:source}) as any;
function shape(value:any):any{
  if(Array.isArray(value))return value.map(shape);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).filter(key=>!['position','data'].includes(key)).sort().map(key=>[key,shape(value[key])]));
  return value;
}
const signature=(nodes:any)=>JSON.stringify(shape(nodes));
const image=(paragraph:any)=>figureImage({children:[paragraph]});
const normalizedUrl=(value:string)=>{try{return decodeURI(value);}catch{return value;}};
function scan(tree:any){
  const captions:{image:any;paragraph:any;nodes:any[]}[]=[],candidates:{image:any;paragraph:any;following:any[]}[]=[];
  const walk=(parent:any)=>{
    for(let index=0;index<(parent.children||[]).length;index++){
      const child=parent.children[index],found=image(child);
      if(found){
        if(found.caption)captions.push({image:found,paragraph:child,nodes:parse(found.caption).children});
        else candidates.push({image:found,paragraph:child,following:parent.children.slice(index+1)});
      }else walk(child);
    }
  };walk(tree);return {captions,candidates};
}
/** Attach only source-confirmed, uniquely matched captions; preserve unrelated edits. */
export function repairImageCaptions(current:string,corrected:string,sourceOf:(url:string)=>string|undefined=()=>undefined){
  const expected=scan(parse(corrected)).captions,{captions:existing,candidates}=scan(parse(current));
  const edits:{from:number;to:number;text:string}[]=[],used=new Set<any>();
  const conflicts:{caption:string;reason:string}[]=[];let recovered=0,already=0;
  const sameImage=(a:any,b:any)=>normalizedUrl(a.url)===normalizedUrl(b.url)||!!sourceOf(a.url)&&normalizedUrl(sourceOf(a.url)!)===normalizedUrl(b.url);
  for(const entry of expected){
    const sig=signature(entry.nodes),unique=expected.filter(value=>signature(value.nodes)===sig).length===1;
    const done=existing.filter(value=>!used.has(value)&&signature(value.nodes)===sig&&(sameImage(value.image,entry.image)||unique));
    if(done.length===1){already++;used.add(done[0]);continue;}
    const matches=candidates.filter(value=>!used.has(value)&&signature(value.following.slice(0,entry.nodes.length))===sig&&(sameImage(value.image,entry.image)||unique));
    if(matches.length!==1||matches[0].paragraph.position.start.column!==1){conflicts.push({caption:entry.image.caption.slice(0,180),reason:'当前图片与原说明无法唯一对应，保留当前内容'});continue;}
    const match=matches[0];used.add(match);
    edits.push({from:match.paragraph.position.start.offset,to:match.following[entry.nodes.length-1].position.end.offset,text:captionedParagraphMarkdown(match.paragraph,entry.image.caption,entry.image.figureAttributes||{})});recovered++;
  }
  let body=current;for(const edit of edits.sort((a,b)=>b.from-a.from))body=body.slice(0,edit.from)+edit.text+body.slice(edit.to);
  return {body,changed:edits.length>0,recovered,already,conflicts};
}

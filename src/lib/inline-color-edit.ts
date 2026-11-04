import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {coloredText,inlineColors,normalizeColor,type ColorField,type InlineColors} from './inline-color';
const parser=unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkDirective);
export interface ColorRange {from:number;to:number;contentFrom:number;contentTo:number;attrs:InlineColors}
export function colorRanges(source:string){
  const ranges:ColorRange[]=[];
  const scan=(node:any)=>{if(node.type==='textDirective'&&node.name==='text'){
    const from=node.position.start.offset,to=node.position.end.offset,raw=source.slice(from,to),end=raw.lastIndexOf(']');
    ranges.push({from,to,contentFrom:from+6,contentTo:from+end,attrs:inlineColors(node.attributes||{})});
  }node.children?.forEach(scan);};scan(parser.parse(source));return ranges;
}
function rewrite(source:string,field:ColorField,value:string|undefined){
  const ranges=colorRanges(source),outer=ranges.filter(range=>!ranges.some(other=>other!==range&&range.from>other.from&&range.to<other.to));
  for(const range of outer.toSorted((a,b)=>b.from-a.from)){
    const attrs={...range.attrs};if(value)attrs[field]=value;else delete attrs[field];
    source=source.slice(0,range.from)+coloredText(rewrite(source.slice(range.contentFrom,range.contentTo),field,value),attrs)+source.slice(range.to);
  }return source;
}
function rewrittenCaret(source:string,field:ColorField,value:string|undefined,at:number):number{
  const ranges=colorRanges(source),outer=ranges.filter(range=>!ranges.some(other=>other!==range&&range.from>other.from&&range.to<other.to));let delta=0;
  for(const range of outer.toSorted((a,b)=>a.from-b.from)){
    if(at<range.from)break;
    const attrs={...range.attrs};if(value)attrs[field]=value;else delete attrs[field];
    const child=source.slice(range.contentFrom,range.contentTo),content=rewrite(child,field,value),insert=coloredText(content,attrs),prefix=Object.keys(attrs).length?6:0;
    if(at<=range.to){
      if(at<=range.contentFrom)return range.from+delta+prefix;
      if(at<=range.contentTo)return range.from+delta+prefix+rewrittenCaret(child,field,value,at-range.contentFrom);
      return range.from+delta+prefix+content.length;
    }
    delta+=insert.length-(range.to-range.from);
  }return at+delta;
}
export function inlineColorEdit(source:string,from:number,to:number,field:ColorField,input:string){
  const value=normalizeColor(input,field);if(input&&!value)return null;
  const containing=colorRanges(source).filter(r=>from>=r.contentFrom&&to<=r.contentTo).sort((a,b)=>(a.to-a.from)-(b.to-b.from));
  const range=(!value?containing.filter(range=>range.attrs[field]).at(-1):undefined)||containing[0];
  if(range){
    const attrs={...range.attrs};if(value)attrs[field]=value;else delete attrs[field];
    if(from===to){const before=source.slice(range.contentFrom,range.contentTo),content=rewrite(before,field,value),insert=coloredText(content,attrs),offset=Object.keys(attrs).length?6:0,caret=range.from+offset+Math.max(0,Math.min(content.length,rewrittenCaret(before,field,value,from-range.contentFrom)));return {from:range.from,to:range.to,insert,anchor:caret,head:caret};}
    const content=source.slice(range.contentFrom,range.contentTo),a=from-range.contentFrom,b=to-range.contentFrom;
    const before=balancedInlineSlice(content,0,a),after=balancedInlineSlice(content,b,content.length),selected=rewrite(balancedInlineSlice(content,a,b),field,value);
    const prefix=before?coloredText(before,range.attrs):'',middle=coloredText(selected,attrs),suffix=after?coloredText(after,range.attrs):'',offset=Object.keys(attrs).length?6:0;
    return {from:range.from,to:range.to,insert:prefix+middle+suffix,anchor:range.from+prefix.length+offset,head:range.from+prefix.length+offset+selected.length};
  }
  const crossing=colorRanges(source).filter(r=>r.from<from&&r.to>from||r.from<to&&r.to>to);
  if(crossing.length&&from!==to){
    let start=Math.min(from,...crossing.map(r=>r.from)),end=Math.max(to,...crossing.map(r=>r.to));
    const scan=(node:any)=>{if(['strong','emphasis','delete','link','textDirective'].includes(node.type)){const a=node.position.start.offset,b=node.position.end.offset;if(a<from&&b>from||a<to&&b>to){start=Math.min(start,a);end=Math.max(end,b);}}node.children?.forEach(scan);};scan(parser.parse(source));
    const fragment=source.slice(start,end),before=balancedInlineSlice(fragment,0,from-start),selected=rewrite(balancedInlineSlice(fragment,from-start,to-start),field,value),after=balancedInlineSlice(fragment,to-start,fragment.length),middle=value?coloredText(selected,{[field]:value}):selected,offset=value?6:0;
    return {from:start,to:end,insert:before+middle+after,anchor:start+before.length+offset,head:start+before.length+offset+selected.length};
  }
  const selected=rewrite(source.slice(from,to),field,value),insert=value?coloredText(selected,{[field]:value}):selected,offset=value?6:0;
  return {from,to,insert,anchor:from+offset,head:from+offset+selected.length};
}

/** Reopen surrounding emphasis/links when splitting a colored span at an inner text selection. */
function balancedInlineSlice(source:string,from:number,to:number):string{
  if(from>=to)return '';
  const slice=(node:any):string=>{
    const start=node.position?.start.offset??0,end=node.position?.end.offset??source.length;
    if(end<=from||start>=to)return '';
    if(start>=from&&end<=to)return source.slice(start,end);
    if(node.children?.length){
      const content=node.children.map(slice).join('');if(!content)return '';
      if(['strong','emphasis','delete','link','textDirective'].includes(node.type))return source.slice(start,node.children[0].position.start.offset)+content+source.slice(node.children.at(-1).position.end.offset,end);
      return content;
    }
    if(['inlineCode','inlineMath'].includes(node.type)){const raw=source.slice(start,end),marker=raw.match(node.type==='inlineCode'?/^`+/:/^\$+/)?.[0]||'';return marker+source.slice(Math.max(start+marker.length,from),Math.min(end-marker.length,to))+marker;}
    return source.slice(Math.max(start,from),Math.min(end,to));
  };
  return slice(parser.parse(source));
}
/** Source selections are split at Markdown text blocks, keeping list and quote prefixes intact. */
export function sourceColorEdits(source:string,from:number,to:number,field:ColorField,value:string){
  if(from===to){const edit=inlineColorEdit(source,from,to,field,value);return edit?[edit]:[];}
  const edits:NonNullable<ReturnType<typeof inlineColorEdit>>[]=[];
  const scan=(node:any)=>{if(['paragraph','heading','tableCell'].includes(node.type)){
    const start=node.position.start.offset,end=node.position.end.offset;
    if(to<=start||from>=end)return;
    const text=source.slice(start,end);let offset=0;
    for(const line of text.split('\n')){const prefix=offset?line.match(/^\s*(?:>\s*)+/)?.[0].length||0:node.type==='heading'?(line.match(/^#{1,6}\s+/)?.[0].length||0):0;const a=Math.max(from,start+offset+prefix),b=Math.min(to,start+offset+line.length);if(b>a){const edit=inlineColorEdit(line,a-start-offset,b-start-offset,field,value);if(edit)edits.push({...edit,from:edit.from+start+offset,to:edit.to+start+offset,anchor:edit.anchor+start+offset,head:edit.head+start+offset});}offset+=line.length+1;}
    return;
  }node.children?.forEach(scan);};scan(parser.parse(source));return edits;
}

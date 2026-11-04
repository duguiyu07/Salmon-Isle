import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import cjk from 'remark-cjk-friendly/parseOnly';
import {$remark} from '@milkdown/kit/utils';
import {commonmark,paragraphSchema,headingSchema,hrSchema,strongInputRule,emphasisStarInputRule,emphasisUnderscoreInputRule,inlineCodeInputRule,wrapInHeadingInputRule,insertHrInputRule} from '@milkdown/kit/preset/commonmark';
import {gfm,strikethroughInputRule} from '@milkdown/kit/preset/gfm';
import {Plugin,PluginKey,TextSelection,type EditorState,type Transaction} from '@milkdown/kit/prose/state';
import {Decoration,DecorationSet,type EditorView} from '@milkdown/kit/prose/view';
import katex from 'katex';
import {closeHistory} from '@milkdown/kit/prose/history';
import {cleanInlineStyle} from './styles';
import {inlineColors,inlineColorStyle,type ColorField} from './inline-color';
import {inlineColorEdit} from './inline-color-edit';

const excluded=new Set<any>([strongInputRule,emphasisStarInputRule,emphasisUnderscoreInputRule,inlineCodeInputRule,wrapInHeadingInputRule,insertHrInputRule,strikethroughInputRule]);
export const liveCommonmark=commonmark.filter(plugin=>!excluded.has(plugin));
export const liveGfm=gfm.filter(plugin=>!excluded.has(plugin));
const parser=unified().use(remarkParse).use(cjk).use(remarkGfm).use(remarkMath).use(remarkDirective);

/** These characters belong to the document, including incomplete Markdown. */
export const liveSyntax=$remark('salmon-live-source',()=>function(this:any){
  (this.data().toMarkdownExtensions||=[]).push({handlers:{salmonSource:(node:any)=>node.value||''}});
  return (tree:any,file:any)=>{
    const source=String(file.value||'');
    const scan=(node:any)=>{
      if(node.type==='thematicBreak')node.liveRaw=source.slice(node.position.start.offset,node.position.end.offset);
      if(['paragraph','heading'].includes(node.type)){
        const children=(node.children||[]).map((child:any)=>{
          if(child.type==='image'||child.type==='link'&&child.children?.some((n:any)=>n.type==='image'))return child;
          let raw=child.position?source.slice(child.position.start.offset,child.position.end.offset):child.value||'';
          // Continuation prefixes belong to the enclosing list/quote, not its text.
          const indent=Math.max(0,(node.position?.start.column||1)-1);
          raw=raw.replace(/\n[ \t]*(?:>[ \t]*)+/g,'\n');
          if(indent)raw=raw.replace(new RegExp(`\\n {1,${indent}}`,'g'),'\n');
          return {type:'text',value:raw};
        });
        if(node.type==='heading')children.unshift({type:'text',value:'#'.repeat(node.depth)+' '});
        node.children=children.filter((child:any)=>child.type!=='text'||child.value);return;
      }
      node.children?.forEach(scan);
    };scan(tree);
  };
});

export function configureLiveMarkdown(ctx:any){
  const write=(state:any,node:any)=>{state.openNode('paragraph');if(node.content.size)node.forEach((child:any)=>{if(child.isText&&!child.marks.length)state.addNode('salmonSource',undefined,child.text);else state.next(child);});else state.addNode('html',undefined,'<br />');state.closeNode();};
  for(const schema of [paragraphSchema,headingSchema])ctx.update(schema.key,(previous:any)=>(context:any)=>{
    const base=previous(context);return {...base,toMarkdown:{...base.toMarkdown,runner:write}};
  });
  ctx.update(hrSchema.key,(previous:any)=>(context:any)=>{
    const base=previous(context);return {...base,content:'inline*',toDOM:()=>['p',{'data-live-rule':'true'},0],
      parseMarkdown:{...base.parseMarkdown,runner:(state:any,node:any,type:any)=>{state.openNode(type);state.addText(node.liveRaw||'---');state.closeNode();}},
      toMarkdown:{...base.toMarkdown,runner:write}};
  });
}

export interface InlineSyntax {kind:string;from:number;to:number;contentFrom:number;contentTo:number;value?:string;url?:string;style?:string;tag?:string}
const syntaxCache=new Map<string,InlineSyntax[]>();
export function inlineSyntax(source:string):InlineSyntax[]{
  const cached=syntaxCache.get(source);if(cached)return cached;
  const result:InlineSyntax[]=[];
  const scan=(node:any)=>{
    const colors={...node.inlineColorContext,...(node.type==='textDirective'&&node.name==='text'?inlineColors(node.attributes||{}):{})};
    const children=()=>node.children?.forEach((child:any)=>{child.inlineColorContext=colors;scan(child);});
    const from=node.position?.start.offset,to=node.position?.end.offset;
    if(from!==undefined&&to!==undefined){
      const raw=source.slice(from,to);let start=from,end=to;
      if(node.type==='strong'||node.type==='emphasis'||node.type==='delete'){
        const width=node.type==='strong'?2:node.type==='delete'?(raw.startsWith('~~')?2:1):1;start+=width;end-=width;
      }else if(node.type==='inlineCode'||node.type==='inlineMath'){
        const width=raw.match(node.type==='inlineCode'?/^`+/:/^\$+/)?.[0].length||1;start+=width;end-=width;
      }else if(node.type==='link'){
        if(raw.startsWith('[')){start=from+1;end=node.children?.at(-1)?.position?.end.offset??to;}
        else if(raw.startsWith('<')){start=from+1;end=to-1;}
      }
      else if(node.type==='textDirective'&&['spoiler','text'].includes(node.name)){start=from+(node.name==='text'?6:9);end=from+raw.lastIndexOf(']');}
      else {children();return;}
      result.push({kind:node.type==='textDirective'?node.name:node.type,from,to,contentFrom:start,contentTo:end,value:node.value,url:node.url,...(node.type==='textDirective'&&node.name==='text'?{style:inlineColorStyle(colors)}:{})});
    }
    children();
  };scan(parser.parse(source));
  // Preserve imported styled spans while editing their actual HTML source.
  const stack:{tag:string;from:number;contentFrom:number;style:string}[]=[];
  for(const match of source.matchAll(/<(\/)?(mark|span|sup|sub|u|strong|b|em|i|s|code)\b([^>]*)>/gi)){
    const tag=match[2].toLowerCase(),from=match.index!;
    if(result.some(range=>['inlineCode','inlineMath'].includes(range.kind)&&from>=range.from&&from<range.to))continue;
    if(!match[1])stack.push({tag,from,contentFrom:from+match[0].length,style:cleanInlineStyle(match[3].match(/style=["']([^"']*)/i)?.[1]||'')});
    else{const index=stack.findLastIndex(entry=>entry.tag===tag);if(index>=0){const entry=stack.splice(index,1)[0];result.push({kind:'html',...entry,to:from+match[0].length,contentTo:from});}}
  }
  if(syntaxCache.size>=256)syntaxCache.delete(syntaxCache.keys().next().value!);syntaxCache.set(source,result);return result;
}

export type InlineFormat='strong'|'emphasis'|'strike_through'|'inlineCode'|'inlineMath';
const kinds:Record<InlineFormat,string>={strong:'strong',emphasis:'emphasis',strike_through:'delete',inlineCode:'inlineCode',inlineMath:'inlineMath'};
export function inlineEdit(text:string,from:number,to:number,format:InlineFormat){
  if(text.slice(from,to).includes('\n'))return null;
  const range=inlineSyntax(text).filter(r=>r.kind===kinds[format]&&from>=r.from&&to<=r.to).sort((a,b)=>(a.to-a.from)-(b.to-b.from))[0];
  if(range){
    const insert=text.slice(range.contentFrom,range.contentTo);
    return {from:range.from,to:range.to,insert,anchor:range.from+Math.max(0,Math.min(insert.length,from-range.contentFrom)),head:range.from+Math.max(0,Math.min(insert.length,to-range.contentFrom))};
  }
  const value=text.slice(from,to);let marker={strong:'**',emphasis:'*',strike_through:'~~',inlineCode:'`',inlineMath:'$'}[format];
  if(format==='inlineCode')marker='`'.repeat(Math.max(0,...Array.from(value.matchAll(/`+/g),match=>match[0].length))+1);
  const pad=format==='inlineCode'&&/^`|`$/.test(value)?' ':'';
  return {from,to,insert:marker+pad+value+pad+marker,anchor:from+marker.length+pad.length,head:from+marker.length+pad.length+value.length};
}
export function formatInline(state:EditorState,format:InlineFormat):Transaction|null{
  const {$from,$to}=state.selection;
  if(!$from.sameParent($to)||!['paragraph','heading','hr'].includes($from.parent.type.name))return null;
  const text=$from.parent.textBetween(0,$from.parent.content.size,'','\uFFFC');
  if(text.slice($from.parentOffset,$to.parentOffset).includes('\uFFFC'))return null;
  const edit=inlineEdit(text,$from.parentOffset,$to.parentOffset,format);if(!edit)return null;
  const start=$from.start(),tr=state.tr.insertText(edit.insert,start+edit.from,start+edit.to);
  return tr.setSelection(TextSelection.create(tr.doc,start+edit.anchor,start+edit.head)).scrollIntoView();
}
export function headingTransaction(state:EditorState,level:number){
  const {$from,$to}=state.selection;if(!$from.sameParent($to)||!['paragraph','heading','hr'].includes($from.parent.type.name))return null;
  const prefix=$from.parent.textContent.match(/^#{1,6}[ \t]+/)?.[0]||'',replacement=level?'#'.repeat(level)+' ':'';
  const start=$from.start(),tr=state.tr.insertText(replacement,start,start+prefix.length);
  tr.setNodeMarkup($from.before(),level?state.schema.nodes.heading:state.schema.nodes.paragraph,level?{level}:undefined);return tr;
}

export function colorTransaction(state:EditorState,field:ColorField,value:string):Transaction|null{
  const tr=state.tr,selection=state.selection,edits:{from:number;to:number;insert:string;anchor:number;head:number}[]=[];
  state.doc.descendants((node,pos)=>{
    if(!['paragraph','heading','hr'].includes(node.type.name)||pos+node.nodeSize-1<selection.from||pos+1>selection.to)return;
    const text=node.textBetween(0,node.content.size,'','\uFFFC'),from=Math.max(0,selection.from-pos-1),to=Math.min(node.content.size,selection.to-pos-1);
    if(text.slice(from,to).includes('\uFFFC'))return;
    const edit=inlineColorEdit(text,from,to,field,value);if(edit)edits.push({...edit,from:edit.from+pos+1,to:edit.to+pos+1,anchor:edit.anchor+pos+1,head:edit.head+pos+1});
  });
  if(!edits.length)return null;
  for(const edit of edits.toReversed())tr.insertText(edit.insert,edit.from,edit.to);
  const first=edits[0],last=edits.at(-1)!,delta=edits.slice(0,-1).reduce((sum,edit)=>sum+edit.insert.length-(edit.to-edit.from),0);
  return closeHistory(tr.setSelection(TextSelection.create(tr.doc,first.anchor,last.head+delta)).scrollIntoView());
}

const liveKey=new PluginKey('salmon-live-markdown');
export function liveShortcut(view:EditorView,event:KeyboardEvent){
  if(!(event.ctrlKey||event.metaKey)||event.isComposing||view.composing)return false;
  const key=event.key.toLowerCase();let format:InlineFormat|undefined;
  if(!event.altKey&&key==='e')format='inlineCode';
  else if(!event.altKey&&event.shiftKey&&key==='m')format='inlineMath';
  else if(!event.altKey&&!event.shiftKey&&key==='b')format='strong';
  else if(!event.altKey&&!event.shiftKey&&key==='i')format='emphasis';
  else if(event.altKey&&key==='x')format='strike_through';
  if(format){const tr=formatInline(view.state,format);if(tr)view.dispatch(tr);return true;}
  if(event.altKey&&/^[0-6]$/.test(key)){const tr=headingTransaction(view.state,Number(key));if(tr)view.dispatch(tr);return true;}
  return false;
}
export function liveMarkdownPlugin(){return new Plugin({
  key:liveKey,
  state:{init:()=>0,apply:tr=>tr.time},
  appendTransaction(transactions,_old,state){
    if(!transactions.some(tr=>tr.docChanged||tr.getMeta(liveKey))||transactions.some(tr=>tr.getMeta('composition')!=null))return null;
    const tr=state.tr;
    state.doc.descendants((node,pos)=>{
      if(!['paragraph','heading','hr'].includes(node.type.name))return;
      const source=node.textContent,heading=source.match(/^(#{1,6})[ \t]+/),rule=/^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(source);
      const type=heading?state.schema.nodes.heading:rule?state.schema.nodes.hr:state.schema.nodes.paragraph;
      if(type!==node.type||heading&&node.attrs.level!==heading[1].length)tr.setNodeMarkup(pos,type,heading?{level:heading[1].length}:undefined);
    });return tr.docChanged?tr:null;
  },
  props:{
    handleDOMEvents:{
      beforeinput(view,event){const input=event as InputEvent;if(!input.cancelable||input.isComposing||view.composing||!['deleteContentBackward','deleteContentForward'].includes(input.inputType))return false;
        const selection=view.state.selection;if(!selection.empty||!selection.$from.parent.isTextblock||!['paragraph','heading','hr'].includes(selection.$from.parent.type.name))return false;
        const text=selection.$from.parent.textContent,offset=selection.$from.parentOffset,backward=input.inputType==='deleteContentBackward';if(backward?offset===0:offset===text.length)return false;
        const segments=Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text));const part=backward?segments.findLast(part=>part.index<offset):segments.find(part=>part.index+part.segment.length>offset);if(!part)return false;
        const start=selection.$from.start();input.preventDefault();view.dispatch(view.state.tr.delete(start+part.index,start+part.index+part.segment.length).scrollIntoView());return true;
      },
      compositionend(view){queueMicrotask(()=>{if(!view.isDestroyed)view.dispatch(view.state.tr.setMeta(liveKey,true));});return false;}
    },
    handleKeyDown:liveShortcut,
    decorations(state){
      const decorations:Decoration[]=[];const selection=state.selection;
      state.doc.descendants((node,pos)=>{
        if(!['paragraph','heading','hr'].includes(node.type.name))return;
        const source=node.textBetween(0,node.content.size,'','\uFFFC'),start=pos+1;
        const intersects=(from:number,to:number)=>selection.from<=start+to&&selection.to>=start+from;
        const hide=(from:number,to:number)=>{if(to>from)decorations.push(Decoration.inline(start+from,start+to,{class:'live-syntax-hidden'}));};
        if(node.type.name==='heading'){
          const prefix=source.match(/^#{1,6}[ \t]+/)?.[0];if(prefix&&!intersects(0,source.length))hide(0,prefix.length);
          else if(prefix)decorations.push(Decoration.inline(start,start+prefix.length,{class:'live-syntax-marker'}));
        }
        if(node.type.name==='hr'&&!intersects(0,source.length)){
          hide(0,source.length);decorations.push(Decoration.widget(start,view=>{
            const line=document.createElement('span');line.className='live-rule-preview';line.contentEditable='false';line.setAttribute('aria-label','编辑分割线');line.addEventListener('mousedown',event=>{event.preventDefault();view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,start)));view.focus();});return line;
          },{key:`rule-${pos}`,side:-1}));
        }
        const ranges=inlineSyntax(source);
        for(const range of ranges){
          const active=intersects(range.from,range.to);
          const classes:Record<string,string>={strong:'live-strong',emphasis:'live-emphasis',delete:'live-strike',inlineCode:'live-code',link:'live-link',spoiler:'live-spoiler',text:'inline-colored-text',html:`live-html live-html-${range.tag}`};
          if(range.kind==='inlineMath'&&!active){
            hide(range.from,range.to);
            decorations.push(Decoration.widget(start+range.from,view=>{
              const span=document.createElement('span');span.className='live-math-preview';span.contentEditable='false';span.setAttribute('aria-label','编辑行内公式');span.innerHTML=katex.renderToString(range.value||'',{throwOnError:false,trust:false,strict:false});
              span.addEventListener('mousedown',event=>{event.preventDefault();view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,start+range.contentFrom)));view.focus();});return span;
            },{key:`math-${pos}-${range.from}-${range.value}`,side:-1}));continue;
          }
          if(classes[range.kind])decorations.push(Decoration.inline(start+range.from,start+range.to,{class:classes[range.kind],...(range.style?{style:range.style}:{})}));
          if(!active){hide(range.from,range.contentFrom);hide(range.contentTo,range.to);}
          else{
            if(range.contentFrom>range.from)decorations.push(Decoration.inline(start+range.from,start+range.contentFrom,{class:'live-syntax-marker'}));
            if(range.to>range.contentTo)decorations.push(Decoration.inline(start+range.contentTo,start+range.to,{class:'live-syntax-marker'}));
          }
        }
        for(const match of source.matchAll(/\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/g)){
          const from=match.index!;if(!intersects(from,from+2)&&!ranges.some(r=>['inlineMath','inlineCode'].includes(r.kind)&&from>=r.from&&from<r.to))hide(from,from+1);
        }
      });return DecorationSet.create(state.doc,decorations);
    },
  },
});}

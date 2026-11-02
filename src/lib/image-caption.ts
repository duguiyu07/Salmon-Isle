import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import directive from 'remark-directive';
import cjk from 'remark-cjk-friendly/parseOnly';
import {visit} from 'unist-util-visit';

const escapeAttribute=(value:string)=>value.replace(/&/g,'&amp;').replace(/"/g,'&#x22;').replace(/\r/g,'&#xD;').replace(/\n/g,'&#xA;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function imageMarkdown(attrs:{src:string;alt?:string;title?:string;caption?:string;figureAttributes?:Record<string,string>}){
  const values={src:attrs.src,...(attrs.title?{title:attrs.title}:{}),caption:attrs.caption||'',...attrs.figureAttributes};
  const alt=(attrs.alt||'').replace(/([\\[\]])/g,'\\$1').replace(/\r?\n/g,' ');
  return `:image[${alt}]{${Object.entries(values).map(([key,value])=>`${key}="${escapeAttribute(value)}"`).join(' ')}}`;
}
export function figureImage(node:any){
  const paragraph=node?.children?.[0];if(paragraph?.type!=='paragraph'||paragraph.children?.length!==1)return null;
  const child=paragraph.children[0];
  return child.type==='image'?child:child.type==='link'&&child.children?.length===1&&child.children[0].type==='image'?child.children[0]:null;
}
function captionedImageHandler(node:any){return imageMarkdown({src:node.url,alt:node.alt,title:node.title,caption:node.caption,figureAttributes:node.figureAttributes});}
export function remarkImageCaptions(this:any){
  const data=this.data();(data.toMarkdownExtensions||=[]).push({handlers:{captionedImage:captionedImageHandler}});
  return (tree:any,file:any)=>{
    const source=String(file.value||'');
    const scan=(parent:any)=>{
      if(!parent.children)return;
      parent.children=parent.children.map((node:any)=>{
        if(node.type==='containerDirective'&&node.name==='figure'){
          const image=figureImage(node);
          if(image){
            const caption=node.children.slice(1);
            image.caption=caption.length?(source&&caption[0].position?source.slice(caption[0].position.start.offset,caption.at(-1).position.end.offset):captionWriter.stringify({type:'root',children:caption}).trim()):'';
            image.figureAttributes=node.attributes||{};
            image.position=node.position;
            return node.children[0];
          }
        }
        if(node.type==='textDirective'&&node.name==='image'){
          const {src='',title='',caption='',...figureAttributes}=node.attributes||{};
          const text=(n:any):string=>n.value||n.children?.map(text).join('')||'';
          return {type:'image',url:src,alt:text(node),title,caption,figureAttributes,position:node.position};
        }
        scan(node);return node;
      });
    };scan(tree);
  };
}
const captionWriter=unified().use(remarkStringify).use(remarkGfm).use(remarkMath).use(directive).use(remarkImageCaptions);
const captionParser=unified().use(remarkParse).use(cjk).use(remarkGfm).use(remarkMath).use(directive);
export function imageSourceMarkdown(attrs:{src:string;alt?:string;title?:string;caption?:string;figureAttributes?:Record<string,string>}){
  if(attrs.caption||Object.keys(attrs.figureAttributes||{}).length)return imageMarkdown(attrs);
  return captionWriter.stringify({type:'root',children:[{type:'paragraph',children:[{type:'image',url:attrs.src,alt:attrs.alt||'',title:attrs.title||''}]}]}).trim();
}
export function linkedImageSourceMarkdown(attrs:{src:string;alt?:string;title?:string;caption?:string;figureAttributes?:Record<string,string>},href?:string,linkTitle?:string){
  const image:any={type:attrs.caption||Object.keys(attrs.figureAttributes||{}).length?'captionedImage':'image',url:attrs.src,alt:attrs.alt||'',title:attrs.title||'',caption:attrs.caption||'',figureAttributes:attrs.figureAttributes||{}};
  return captionWriter.stringify({type:'root',children:[{type:'paragraph',children:[href?{type:'link',url:href,title:linkTitle||null,children:[image]}:image]}]}).trim();
}
export function captionedParagraphMarkdown(paragraph:any,caption:string,attributes:Record<string,string>={}){
  const replacement=structuredClone(paragraph),target=figureImage({children:[replacement]});
  Object.assign(target,{type:'captionedImage',caption,figureAttributes:attributes});
  return captionWriter.stringify({type:'root',children:[replacement]}).trim();
}
/** Surgical conversion: surrounding Markdown, code and math are left byte-for-byte intact. */
export function upgradeLegacyImageCaptions(source:string){
  const tree=captionParser.parse(source),edits:{from:number;to:number;text:string}[]=[];
  visit(tree,(node:any)=>{
    if(node.type!=='containerDirective'||node.name!=='figure')return;
    const image=figureImage(node);if(!image)return;
    const captions=node.children.slice(1);
    const caption=captions.length?source.slice(captions[0].position.start.offset,captions.at(-1).position.end.offset):'';
    edits.push({from:node.position.start.offset,to:node.position.end.offset,text:captionedParagraphMarkdown(node.children[0],caption,node.attributes||{})});
  });
  for(const edit of edits.sort((a,b)=>b.from-a.from))source=source.slice(0,edit.from)+edit.text+source.slice(edit.to);
  return source;
}
/** Turn attributed images into semantic figures without placing a figure inside a paragraph. */
export function renderImageCaptions(){
  return (tree:any)=>{
    const scan=(parent:any)=>{
      if(!parent.children)return;
      parent.children=parent.children.flatMap((node:any)=>{
        scan(node);
        if(node.type!=='paragraph')return [node];
        const result:any[]=[];let inline:any[]=[];
        const flush=()=>{if(inline.length){result.push({...node,children:inline});inline=[];}};
        for(const child of node.children){
          const image=child.type==='image'?child:child.type==='link'&&child.children?.length===1&&child.children[0].type==='image'?child.children[0]:null;
          if(!image||!image.caption&&!Object.keys(image.figureAttributes||{}).length){inline.push(child);continue;}
          flush();const captionSource=image.caption||'',captionTree=captionParser.parse(captionSource);
          visit(captionTree,(captionNode:any)=>{
            if(captionNode.type==='textDirective'&&captionNode.name!=='spoiler'){
              captionNode.type='text';captionNode.value=captionSource.slice(captionNode.position.start.offset,captionNode.position.end.offset);delete captionNode.children;
            }
          });
          result.push({type:'containerDirective',name:'figure',attributes:image.figureAttributes||{},children:[{type:'paragraph',children:[child]},...captionTree.children]});
        }flush();return result;
      });
    };scan(tree);
  };
}

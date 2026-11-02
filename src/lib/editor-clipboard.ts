import TurndownService from 'turndown';
import {gfm} from 'turndown-plugin-gfm';
import {MathMLToLaTeX} from 'mathml-to-latex';
import {inlineSyntax} from './live-markdown';

/** Read formula roots once, before a rich-text converter visits their descendants. */
export function htmlClipboardMarkdown(html:string){
  const template=document.createElement('template');template.innerHTML=html;const root=template.content;
  const formulas:{token:string;latex:string;block:boolean}[]=[];
  let prefix='SALMONCLIPFORMULA';while(html.includes(prefix))prefix+='X';
  const protect=(element:Element,block=false)=>{
    if(!root.contains(element))return;
    const math=element.matches('math')?element:element.querySelector('math');
    let latex=element.getAttribute('data-latex')||math?.getAttribute('data-latex')||element.querySelector('annotation[encoding="application/x-tex"]')?.textContent||'';
    if(!latex&&element.matches('script[type^="math/tex"]'))latex=element.textContent||'';
    if(!latex&&math)try{latex=MathMLToLaTeX.convert(math.outerHTML);}catch{}
    if(!latex)return;
    const token=`${prefix}${formulas.length}END`;
    formulas.push({token,latex:latex.trim(),block:block||math?.getAttribute('display')==='block'});element.replaceWith(document.createTextNode(token));
  };
  root.querySelectorAll('.katex-display,mjx-container[display="true"],.MathJax_Display').forEach(element=>protect(element,true));
  root.querySelectorAll('.katex,mjx-container,.MathJax,math,script[type^="math/tex"]').forEach(element=>protect(element,/mode=display/.test(element.getAttribute('type')||'')));
  root.querySelectorAll('script,style,.katex-html,mjx-assistive-mml').forEach(element=>element.remove());
  const service=new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced',emDelimiter:'*',strongDelimiter:'**',bulletListMarker:'-'});service.use(gfm);
  let markdown=service.turndown(template.innerHTML);
  for(const formula of formulas)markdown=markdown.split(formula.token).join(formula.block?`\n\n$$\n${formula.latex}\n$$\n\n`:`$${formula.latex}$`);
  return markdown;
}

export function clipboardMarkdown(data:Pick<DataTransfer,'getData'>):string|null{
  const explicit=data.getData('text/markdown');if(explicit)return explicit;
  const text=data.getData('text/plain'),html=data.getData('text/html');
  if(!text&&!html)return null;
  if(html&&/(?:class=["'][^"']*(?:katex|MathJax)|<math\b|<mjx-container\b|type=["']math\/tex)/i.test(html))return htmlClipboardMarkdown(html);
  if(text&&(inlineSyntax(text).length||/^\s*(?:#{1,6}\s|```|:::|[-*+]\s|\d+[.)]\s|>\s|---\s*$)/m.test(text)))return text;
  return html?htmlClipboardMarkdown(html):text;
}

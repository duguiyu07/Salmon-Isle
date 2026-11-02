import type { CheerioAPI } from 'cheerio';
import { MathMLToLaTeX } from 'mathml-to-latex';

/** Preserve source TeX before Turndown flattens MathML's visual and annotation trees. */
export function protectWordPressMath($: CheerioAPI,onWarning?:(message:string)=>void) {
  const source=$.html();let prefix='SALMONFORMULATOKEN';while(source.includes(prefix))prefix+='X';
  const formulas: {token:string;latex:string;display:boolean}[]=[];
  const latexOf=(math:ReturnType<CheerioAPI>)=>{
    const explicit=math.attr('data-latex')||math.find('annotation[encoding="application/x-tex"]').first().text();if(explicit)return explicit;
    if(!math.length)return '';
    try{return MathMLToLaTeX.convert($.html(math[0])).replace(/[\u200b\ufeff]/g,'');}catch{onWarning?.('无法从 MathML 恢复 LaTeX，请核对源公式');return '';}
  };
  const replace=(element:any,latex:string,display:boolean)=>{
    const token=`${prefix}${formulas.length}END`;formulas.push({token,latex:latex.trim(),display});$(element).replaceWith(token);
  };
  $('.katex').each((_,element)=>{
    const root=$(element);const math=root.find('math').first();
    const latex=latexOf(math)||root.find('annotation[encoding="application/x-tex"]').first().text();
    if(latex)replace(element,latex,root.parent().hasClass('katex-display')||math.attr('display')==='block');
  });
  $('math').each((_,element)=>{
    const math=$(element);const latex=latexOf(math);
    if(latex)replace(element,latex,math.attr('display')==='block');
  });
  $('script[type="math/tex"],script[type="math/tex; mode=display"]').each((_,element)=>replace(element,$(element).text(),/mode=display/.test($(element).attr('type')||'')));
  return {formulas,restore:(markdown:string)=>formulas.reduce((text,f)=>text.split(f.token).join(f.display?`\n\n$$\n${f.latex}\n$$\n\n`:`$${f.latex}$`),markdown)};
}

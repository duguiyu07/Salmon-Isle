'use client';
import { Facet,StateEffect,StateField } from '@codemirror/state';
import { Decoration,EditorView,ViewPlugin,ViewUpdate,type DecorationSet } from '@codemirror/view';
import { codeLanguage } from '@/lib/code-languages';
import type { HighlighterCore } from 'shiki/core';

let highlighter:Promise<HighlighterCore>|undefined;
const pending=new Map<string,Promise<void>>();
async function getHighlighter(){
  return highlighter??=(async()=>{
    const [{createHighlighterCore},{createOnigurumaEngine},light,dark]=await Promise.all([import('shiki/core'),import('shiki/engine/oniguruma'),import('shiki/themes/github-light.mjs'),import('shiki/themes/github-dark.mjs')]);
    return createHighlighterCore({themes:[light.default,dark.default],langs:[],engine:createOnigurumaEngine(import('shiki/wasm'))});
  })();
}
export async function highlightCode(source:string,language:string){
  const lang=codeLanguage(language);
  if(lang==='text'||!source)return Decoration.none;
  const engine=await getHighlighter();
  if(!engine.getLoadedLanguages().includes(lang)){
    if(!pending.has(lang))pending.set(lang,(async()=>{const {bundledLanguages}=await import('shiki/langs');await engine.loadLanguage(bundledLanguages[lang as keyof typeof bundledLanguages]);})().finally(()=>pending.delete(lang)));
    await pending.get(lang);
  }
  const tokens=engine.codeToTokensWithThemes(source,{lang,themes:{light:'github-light',dark:'github-dark'}});
  const ranges=tokens.flatMap(line=>line.filter(t=>t.content.length).map(t=>{
    const light=t.variants.light,dark=t.variants.dark;
    const style=`--code-light:${light.color||'inherit'};--code-dark:${dark.color||'inherit'};--code-light-style:${(light.fontStyle||0)&1?'italic':'normal'};--code-dark-style:${(dark.fontStyle||0)&1?'italic':'normal'};--code-light-weight:${(light.fontStyle||0)&2?'700':'400'};--code-dark-weight:${(dark.fontStyle||0)&2?'700':'400'}`;
    return Decoration.mark({class:'code-token',attributes:{style}}).range(t.offset,t.offset+t.content.length);
  }));
  return Decoration.set(ranges,true);
}
export const highlightLanguage=Facet.define<string,string>({combine:values=>values[0]||'text'});
const result=StateEffect.define<DecorationSet>();
const tokenField=StateField.define<DecorationSet>({
  create:()=>Decoration.none,
  update(value,tr){value=value.map(tr.changes);for(const effect of tr.effects)if(effect.is(result))value=effect.value;return value;},
  provide:field=>EditorView.decorations.from(field),
});
const plugin=ViewPlugin.fromClass(class{
  generation=0;timer:ReturnType<typeof setTimeout>|undefined;destroyed=false;
  constructor(readonly view:EditorView){this.schedule();}
  schedule(){
    const generation=++this.generation;clearTimeout(this.timer);
    this.timer=setTimeout(async()=>{
      const source=this.view.state.doc.toString(),language=this.view.state.facet(highlightLanguage);
      try{const decorations=await highlightCode(source,language);if(!this.destroyed&&generation===this.generation)this.view.dispatch({effects:result.of(decorations)});}
      catch{if(!this.destroyed&&generation===this.generation)this.view.dispatch({effects:result.of(Decoration.none)});}
    },80);
  }
  update(update:ViewUpdate){if(update.docChanged||update.startState.facet(highlightLanguage)!==update.state.facet(highlightLanguage))this.schedule();}
  destroy(){this.destroyed=true;this.generation++;clearTimeout(this.timer);}
});
export const shikiHighlight=[tokenField,plugin];

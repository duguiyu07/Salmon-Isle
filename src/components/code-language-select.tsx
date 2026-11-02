'use client';
import { useEffect,useState } from 'react';
import { codeLanguages,codeLanguage,knownCodeLanguage,recentLanguages } from '@/lib/code-languages';

const key='salmon-code-languages';
const event='salmon-code-languages-changed';
function readRecent(){try{return recentLanguages(JSON.parse(localStorage.getItem(key)||'[]'));}catch{return [];}}
export function rememberLanguage(language:string){
  try{localStorage.setItem(key,JSON.stringify(recentLanguages(readRecent(),language)));}catch{}
  window.dispatchEvent(new Event(event));
}
function groups(recent:string[]){return [
  {label:'最近使用',languages:codeLanguages.filter(l=>recent.includes(l.id)).sort((a,b)=>recent.indexOf(a.id)-recent.indexOf(b.id))},
  {label:'全部语言',languages:codeLanguages.filter(l=>!recent.includes(l.id))},
];}
export function LanguageSelect({value,onChange}:{value:string;onChange:(value:string)=>void}){
  const [recent,setRecent]=useState<string[]>([]);
  useEffect(()=>{const update=()=>setRecent(readRecent());update();window.addEventListener(event,update);return()=>window.removeEventListener(event,update);},[]);
  const known=knownCodeLanguage(value||'text');
  return <select aria-label="代码语言" value={known?codeLanguage(value):value} onChange={e=>{onChange(e.target.value);rememberLanguage(e.target.value);}}>
    {!known&&<option value={value}>{value}（未知语言）</option>}
    {groups(recent).filter(g=>g.languages.length).map(g=><optgroup key={g.label} label={g.label}>{g.languages.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>)}
  </select>;
}
/** NodeViews use the same menu and browser history as the source-mode toolbar. */
export function mountLanguageSelect(select:HTMLSelectElement,value:()=>string,onChange:(language:string)=>void){
  function draw(){
    const current=value()||'text';select.replaceChildren();
    if(!knownCodeLanguage(current)){const option=new Option(`${current}（未知语言）`,current);select.add(option);}
    for(const group of groups(readRecent())){
      if(!group.languages.length)continue;
      const options=document.createElement('optgroup');options.label=group.label;
      for(const language of group.languages)options.append(new Option(language.name,language.id));select.append(options);
    }
    select.value=knownCodeLanguage(current)?codeLanguage(current):current;
  }
  function change(){onChange(select.value);rememberLanguage(select.value);}
  select.setAttribute('aria-label','代码语言');select.addEventListener('change',change);window.addEventListener(event,draw);draw();
  return {update(){const current=value()||'text';const normalized=knownCodeLanguage(current)?codeLanguage(current):current;if(select.value!==normalized)draw();},destroy(){select.removeEventListener('change',change);window.removeEventListener(event,draw);}};
}

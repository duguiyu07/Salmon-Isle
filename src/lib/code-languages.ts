import { bundledLanguagesInfo } from 'shiki/langs';

export const codeLanguages = [
  {id:'text',name:'纯文本',aliases:['plaintext','plain','txt']},
  ...bundledLanguagesInfo.map(({id,name,aliases})=>({id,name,aliases:aliases||[]})).sort((a,b)=>a.name.localeCompare(b.name,'en')),
];
const lookup=new Map<string,string>();
for(const language of codeLanguages) for(const name of [language.id,language.name,...language.aliases]) lookup.set(name.trim().toLowerCase(),language.id);
export function codeLanguage(value: string | undefined) { return lookup.get((value||'text').trim().toLowerCase()) || 'text'; }
export function knownCodeLanguage(value:string) { return lookup.has(value.trim().toLowerCase()); }
export function languageName(value:string) { return codeLanguages.find(l=>l.id===codeLanguage(value))?.name || value; }
export function recentLanguages(values:unknown,chosen?:string):string[] {
  const candidates=[...(chosen?[chosen]:[]),...(Array.isArray(values)?values:[])];
  return [...new Set(candidates.filter((v):v is string=>typeof v==='string'&&knownCodeLanguage(v)).map(codeLanguage))].slice(0,8);
}

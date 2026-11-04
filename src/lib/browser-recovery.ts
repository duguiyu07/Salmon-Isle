import type {DraftDocument} from './editor-draft-model';
const prefix='salmon-editor-recovery:';
export interface BrowserRecovery {key:string;document:DraftDocument;savedAt:string}
export function saveBrowserRecovery(session:string,document:DraftDocument){
  try{const {password:_password,...safe}=document;localStorage.setItem(prefix+document.id+':'+session,JSON.stringify({document:safe,savedAt:new Date().toISOString()}));}catch{}
}
export function clearBrowserRecovery(session:string,id:string){try{localStorage.removeItem(prefix+id+':'+session);}catch{}}
export function removeBrowserRecovery(key:string){try{localStorage.removeItem(key);}catch{}}
export function browserRecoveries():BrowserRecovery[]{
  try{
    const result:BrowserRecovery[]=[];
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i)!;if(!key.startsWith(prefix)&&key!=='salmon-editor-recovery')continue;
      try{const value=JSON.parse(localStorage.getItem(key)!),document=key==='salmon-editor-recovery'?value:value.document;
        if(!document||typeof document.body!=='string'||typeof document.id!=='string')continue;
        const {password:_password,...safe}=document;result.push({key,document:safe,savedAt:value.savedAt||''});
      }catch{}
    }
    return result.sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
  }catch{return [];}
}

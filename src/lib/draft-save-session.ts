import {draftFingerprint,type DraftDocument,type DraftTokens,type DraftSaveResult,type ClientArticle} from './editor-draft-model';

export interface SaveStatus {phase:'idle'|'saving'|'saved'|'error';savedAt?:string;error?:string;blocked?:boolean}
interface Options{
  read:()=>DraftDocument;
  tokens:DraftTokens;
  draft?:DraftSaveResult;
  savedDocument?:DraftDocument;
  save:(document:DraftDocument,tokens:DraftTokens)=>Promise<DraftSaveResult>;
  push:(tokens:DraftTokens)=>Promise<ClientArticle>;
  unpublish:(tokens:DraftTokens)=>Promise<DraftSaveResult>;
  onSaved:(result:DraftSaveResult,snapshot:DraftDocument)=>void;
  onPushed:(article:ClientArticle)=>void;
  onStatus:(status:SaveStatus)=>void;
}
/** One queue per editor session; responses never replace the editable document. */
export class DraftSaveSession{
  private tail:Promise<unknown>=Promise.resolve();
  private fingerprint:string;
  private tokens:DraftTokens;
  private latest?:DraftSaveResult;
  blocked=false;
  constructor(private options:Options){
    this.fingerprint=draftFingerprint(options.savedDocument||options.read());this.tokens={...options.tokens};this.latest=options.draft;
  }
  dirty(){return draftFingerprint(this.options.read())!==this.fingerprint;}
  private enqueue<T>(action:()=>Promise<T>):Promise<T>{
    const result=this.tail.then(async()=>{
      if(this.blocked)throw new Error('请重新载入后处理版本冲突');
      try{return await action();}catch(error){
        this.blocked=[401,409].includes((error as {status?:number}).status||0);
        this.options.onStatus({phase:'error',error:(error as Error).message,blocked:this.blocked});throw error;
      }
    });
    this.tail=result.catch(()=>{});return result;
  }
  private async saveNow(ensure=false){
    if(!this.dirty()&&(!ensure||this.latest))return this.latest;
    const snapshot=structuredClone(this.options.read());this.options.onStatus({phase:'saving'});
    const result=await this.options.save(snapshot,{...this.tokens});
    this.tokens={baseVersion:result.draft.baseVersion,draftVersion:result.draft.draftVersion};this.latest=result;
    this.fingerprint=draftFingerprint({...snapshot,password:''});
    this.options.onSaved(result,snapshot);
    this.options.onStatus({phase:'saved',savedAt:result.draft.savedAt});return result;
  }
  save(){return this.enqueue(()=>this.saveNow(!this.tokens.baseVersion));}
  push(){return this.enqueue(async()=>{
    await this.saveNow(true);
    if(this.dirty())await this.saveNow();
    this.options.onStatus({phase:'saving'});
    const snapshot=structuredClone(this.latest!.draft.document),article=await this.options.push({...this.tokens});
    this.tokens={baseVersion:article.version,draftVersion:null};this.latest=undefined;
    this.fingerprint=draftFingerprint(snapshot);this.options.onPushed(article);
    this.options.onStatus({phase:'saved',savedAt:new Date().toISOString()});return article;
  });}
  unpublish(){return this.enqueue(async()=>{
    await this.saveNow(true);this.options.onStatus({phase:'saving'});
    const snapshot=structuredClone(this.latest!.draft.document),result=await this.options.unpublish({...this.tokens});
    this.tokens={baseVersion:result.draft.baseVersion,draftVersion:result.draft.draftVersion};this.latest=result;
    this.options.onSaved(result,snapshot);this.options.onStatus({phase:'saved',savedAt:result.draft.savedAt});return result;
  });}
  startAutosave(schedule:(callback:()=>void,delay:number)=>ReturnType<typeof setInterval>=setInterval){
    return schedule(()=>{if(!this.blocked&&this.dirty())void this.save().catch(()=>{});},60000);
  }
}

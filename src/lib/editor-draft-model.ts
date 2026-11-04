import type {Article,ArticleMeta} from './model';

export type DraftDocument=Partial<Omit<Article,'passwordHash'>>&{title:string;body:string;folderId:string;password?:string;hasPassword?:boolean};
export type PageDocument=DraftDocument&{kind:'page';contentFormat:'html'};
export interface EditorDraft {
  articleId:string; baseVersion:string; draftVersion:string; savedAt:string;
  document:Partial<ArticleMeta>&{title:string;body:string;folderId:string};
  baseDocument?:Partial<ArticleMeta>&{body:string;folderId:string};
}
export type ClientEditorDraft=Omit<EditorDraft,'document'|'baseDocument'>&{document:DraftDocument};
export interface EditorDraftSummary {articleId:string;title:string;folderId:string;savedAt:string;baseVersion:string;draftVersion:string}
export type ClientArticle=Omit<Article,'passwordHash'>&{hasPassword:boolean};
export type ClientArticleSummary=Omit<ClientArticle,'body'|'css'>;
export interface DraftSaveResult {article:ClientArticle;draft:ClientEditorDraft}
export interface DraftTokens {baseVersion:string|null;draftVersion:string|null}
export function draftFingerprint(document:DraftDocument){
  const defaults:Record<string,unknown>={title:'',body:'',folderId:'root',kind:'post',contentFormat:'markdown',css:'',route:'',template:'standard',collection:null,summary:'',cover:'',pinned:false,order:0,access:'inherit',aliases:[],giscusTerm:'',tags:[],password:''};
  return JSON.stringify(Object.fromEntries(Object.keys(defaults).map(key=>[key,(document as Record<string,unknown>)[key]??defaults[key]])));
}

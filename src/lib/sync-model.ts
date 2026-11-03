export const syncProtocol=1;
export type SyncPhase='unconfigured'|'syncing'|'synced'|'offline'|'error';
export interface SyncConnection {siteUrl:string;deviceId:string;libraryId:string;generation:string;cursor:number}
export interface SyncStatus {phase:SyncPhase;siteUrl?:string;pending:number;lastSyncedAt?:string;error?:string;connected:boolean}
export interface SyncFile {path:string;hash:string;data?:string;blob?:boolean}
export interface SyncPatch {files:SyncFile[];deleted:string[]}
export interface SyncOperation {id:string;kind:'draft'|'structural'|'publish'|'unpublish';target?:string;patch?:SyncPatch;tokens?:{baseVersion:string|null;draftVersion:string|null};libraryId:string;generation:string}
export interface SyncReceipt {id:string;cursor:number;patch?:SyncPatch;result?:unknown}

export interface GitChange {path:string;oldPath?:string;status:string}
export interface GitCommit {sha:string;author:string;time:string;message:string}
export interface GitStatus {configured:boolean;remote?:string;branch?:string;workspace?:string;siteUrl?:string;head?:string|null;remoteHead?:string|null;liveRevision?:string|null;ahead:number;behind:number;changes:GitChange[];conflicts:string[];error?:string;lastChecked?:string;phase:'unconfigured'|'saved'|'pending'|'push-pending'|'sync-pending'|'synced'|'conflict'|'error'}
export interface GitDiff {path:string;beforePath:string;before:string;after:string;patch:string;binary:boolean;beforeExists:boolean;afterExists:boolean;beforeRevision:string|null;afterRevision:string|null;type?:string}
export interface GitConflict {path:string;binary:boolean;base:string;local:string;remote:string;hasLocal:boolean;hasRemote:boolean}

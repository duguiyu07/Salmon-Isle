// Legacy file journal format; no network synchronization.
export interface LibraryFile {path:string;hash:string;data?:string;blob?:boolean;source?:string}
export interface LibraryPatch {files:LibraryFile[];deleted:string[]}

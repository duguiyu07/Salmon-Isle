export interface Media {id:string;name:string;type:string;size:number;owner:string;source?:string;createdAt?:string}
export interface MediaReference {id:string;title:string;location:string;kind:'article'|'draft'|'trash';field:string;href:string;trashId?:string}
export type MediaUsage='all'|'unused'|'trash'|'active';
export interface MediaPage {items:Media[];total:number;totalAll:number;page:number;pageSize:number;pages:number}
export const mediaAccept='image/png,image/jpeg,image/webp,image/gif,image/avif,.svg,.pdf,.txt,.zip,.mp3,.mp4,.webm';

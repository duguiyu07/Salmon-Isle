export function workspaceMediaUrl(url:string){return /^\/api\/media\/[a-zA-Z0-9_-]+(?:\?|$)/.test(url)&&!/[?&]workspace=/.test(url)?url+(url.includes('?')?'&':'?')+'workspace=1':url;}
export function workspacePreviewUrls(value:string){return value.replace(/\/api\/media\/[a-zA-Z0-9_-]+(?:\?[^"'\s<>)]*)?/g,url=>workspaceMediaUrl(url));}

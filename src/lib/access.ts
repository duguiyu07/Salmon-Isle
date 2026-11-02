import { Article, Folder, Gate, Viewer, Visibility, PublicArticle } from './model';
import { digest } from './crypto';
import { listFolders } from './storage';
export function visibility(article: Pick<Article,'id'|'title'|'access'|'passwordHash'|'folderId'|'status'>, folders = listFolders()): Visibility {
  const chain: (Folder | typeof article)[] = []; let folder = folders.find(f => f.id === article.folderId); const seen = new Set<string>();
  while (folder && !seen.has(folder.id)) { seen.add(folder.id); chain.unshift(folder); folder = folders.find(f => f.id === folder!.parentId); }
  chain.push(article);
  const hidden = article.status !== 'published' || chain.some(p => p.access === 'private');
  const gates: Gate[] = chain.filter(p => p.access === 'password').map(p => ({id:p.id,name:'title' in p?p.title:p.name,hash:p.passwordHash || '',fingerprint:digest(`${p.id}:${p.passwordHash || 'missing'}`)}));
  return { hidden, gates, restricted: hidden || gates.length > 0 };
}
export function canRead(article: Article, viewer: Viewer, folders?: Folder[]) {
  if (viewer.admin) return true; const rule = visibility(article,folders);
  return !rule.hidden && rule.gates.every(g => viewer.grants.has(g.fingerprint));
}
export function folderVisible(folder: Folder, folders: Folder[], viewer: Viewer) {
  return !visibility({ id:'folder-check',title:folder.name,access:'inherit',folderId:folder.id,status:'published' },folders).hidden;
}
export function publicArticle(a: Article, viewer: Viewer, folders = listFolders()): PublicArticle | null {
  const rule = visibility(a,folders); if (rule.hidden) return null;
  const locked = rule.gates.length > 0;
  // Listing metadata stays minimal for all password-protected articles, even after unlock.
  return { id:a.id,title:a.title,createdAt:a.createdAt,updatedAt:a.updatedAt,summary:rule.restricted?'':a.summary,cover:rule.restricted?undefined:a.cover,
    pinned:a.pinned,folderId:a.folderId,folderName:folders.find(f=>f.id===a.folderId)?.name || '',locked,kind:a.kind };
}

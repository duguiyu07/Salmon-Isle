export type Access = 'inherit' | 'public' | 'private' | 'password';
export interface Policy { access: Access; passwordHash?: string }
export interface ArticleMeta extends Policy {
  id: string; title: string; kind: 'post' | 'page'; status: 'draft' | 'published';
  createdAt: string; updatedAt: string; summary: string; cover?: string; pinned: boolean;
  order: number; aliases: string[]; tags: string[]; giscusTerm?: string;
  source?: { site: string; id: string }; trashedAt?: string;
  template?: 'standard' | 'collection';
  collection?: { folderId: string; perPage: number };
  contentFormat?: 'markdown' | 'html'; css?: string; route?: string;
}
export interface Article extends ArticleMeta {
  body: string; path: string; folderId: string; version: string;
}
export interface Folder extends Policy { id: string; name: string; path: string; parentId: string; order: number; aliases?: string[] }
export interface Gate { id: string; name: string; hash: string; fingerprint: string }
export interface Visibility { hidden: boolean; gates: Gate[]; restricted: boolean }
export interface Viewer { admin: boolean; grants: Set<string> }
export interface PublicArticle {
  id: string; title: string; createdAt: string; updatedAt: string; summary: string;
  cover?: string; pinned: boolean; folderId: string; folderName: string; locked: boolean; kind: 'post' | 'page';
}
export interface SiteSettings {
  title: string; subtitle: string; email: string; logo: string; description: string; footer: string;
  navigation: { label: string; href: string }[]; homeFolders: string[];
  knowledgeRootId?: string;
  giscus: { repo: string; repoId: string; category: string; categoryId: string; enabled: boolean };
}
export const defaultSettings: SiteSettings = {
  title: 'salmon-isle', subtitle: 'Everyday is night', email: 'duhelan07@outlook.com',
  logo: '/brand/logo.png', description: '一座位于大洋某处的小岛。记录、整理，然后继续探索。',
  footer: '京ICP备2025144401号',
  navigation: [{ label: '关于我', href: '/about' }, { label: '归档', href: '/knowledge' }, { label: 'MISC', href: '/misc' }],
  homeFolders: [],
  giscus: { enabled: true, repo: 'duguiyu07/salmon-isle', repoId: 'R_kgDOPcvvhA', category: 'Announcements', categoryId: 'DIC_kwDOPcvvhM4CuFzo' }
};
export class AppError extends Error { constructor(message: string, public status = 400) { super(message); } }

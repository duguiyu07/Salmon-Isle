import fs from 'node:fs';
import path from 'node:path';
import { cookies } from 'next/headers';
import { dataDir } from './paths';
import { db } from './db';
import { digest, token } from './crypto';
import { AppError, Viewer } from './model';
export const ADMIN_COOKIE = 'salmon_admin';
export const VISITOR_COOKIE = 'salmon_visitor';
export function adminHash() {
  if (process.env.SALMON_ADMIN_HASH) return process.env.SALMON_ADMIN_HASH;
  const file = path.join(dataDir(),'admin.json');
  return fs.existsSync(file) ? String(JSON.parse(fs.readFileSync(file,'utf8')).hash || '') : '';
}
export async function getViewer(): Promise<Viewer> {
  const jar = await cookies(); const adminToken = jar.get(ADMIN_COOKIE)?.value;
  let admin = false;
  if (adminToken) {
    const row = db().prepare('SELECT expires,credential FROM sessions WHERE id=?').get(digest(adminToken)) as { expires: number; credential: string } | undefined;
    admin = !!(row && row.expires > Date.now() && row.credential === digest(adminHash()));
  }
  const visitor = jar.get(VISITOR_COOKIE)?.value; const grants = new Set<string>();
  if (visitor) for (const row of db().prepare('SELECT fingerprint FROM grants WHERE session=? AND expires>?').all(digest(visitor),Date.now()) as {fingerprint:string}[]) grants.add(row.fingerprint);
  return { admin,grants };
}
export async function requireAdmin() { if (!(await getViewer()).admin) throw new AppError('请先登录管理后台',401); }
export function cookieOptions(maxAge: number) { return { httpOnly:true, sameSite:'lax' as const, secure:process.env.SALMON_SECURE_COOKIES === 'true', path:'/',maxAge }; }
export async function createAdminSession() {
  const value = token(); const lifetime = 12 * 3600;
  db().prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(value),Date.now()+lifetime*1000,digest(adminHash()));
  (await cookies()).set(ADMIN_COOKIE,value,cookieOptions(lifetime));
}
export async function grantAccess(gateId: string, fingerprint: string) {
  const jar = await cookies(); let visitor = jar.get(VISITOR_COOKIE)?.value;
  if (!visitor || !/^[a-f0-9]{64}$/.test(visitor)) { visitor = token(); jar.set(VISITOR_COOKIE,visitor,cookieOptions(8*3600)); }
  db().prepare('INSERT OR REPLACE INTO grants VALUES(?,?,?,?)').run(digest(visitor),gateId,fingerprint,Date.now()+8*3600*1000);
}

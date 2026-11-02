import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
export function digest(input: string | Buffer) { return createHash('sha256').update(input).digest('hex'); }
export function hashPassword(password: string) {
  if (!password || password.length > 1024) throw new Error('密码长度无效');
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, encoded = '') {
  try { const [method, salt, hash] = encoded.split('$');
    if (method !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash) || password.length > 1024) return false;
    return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, 'hex'));
  } catch { return false; }
}
export function token() { return randomBytes(32).toString('hex'); }

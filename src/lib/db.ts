import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { dataDir, initDirs } from './paths';
import {libraryRoot} from './library-context';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
const databases = new Map<string, DatabaseSync>();
export function closeDatabases(){for(const database of databases.values())database.close();databases.clear();}
export function db() {
  initDirs(); const file = path.join(dataDir(), 'state.sqlite');
  let database = databases.get(file); if (database) return database;
  database = new DatabaseSync(file);
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL, credential TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS grants (session TEXT NOT NULL, gate TEXT NOT NULL, fingerprint TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(session, gate));
    CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, path TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, time TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, owner TEXT NOT NULL, source TEXT);
  `);
  databases.set(file, database); return database;
}
export function audit(action: string, target: string) { db().prepare('INSERT INTO audit(time,action,target) VALUES(?,?,?)').run(new Date().toISOString(), action, target); }
export function indexDb(){
  if(libraryRoot()===dataDir())return db();
  const dir=path.join(dataDir(),'library-indexes');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,createHash('sha256').update(libraryRoot()).digest('hex')+'.sqlite');
  let database=databases.get(file);if(database)return database;
  database=new DatabaseSync(file);database.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,path TEXT NOT NULL)');databases.set(file,database);return database;
}
export function throttle(key: string, limit = 8, windowMs = 15 * 60 * 1000) {
  const now = Date.now(); const row = db().prepare('SELECT count,reset FROM attempts WHERE key=?').get(key) as { count: number; reset: number } | undefined;
  if (row && row.reset > now && row.count >= limit) return false;
  if (!row || row.reset <= now) db().prepare('INSERT OR REPLACE INTO attempts VALUES(?,1,?)').run(key, now + windowMs);
  else db().prepare('UPDATE attempts SET count=count+1 WHERE key=?').run(key);
  return true;
}

import {randomBytes} from 'node:crypto';
import {digest} from './password';
export const COOKIE='__Host-supply-session';
export const SESSION_SECONDS=30*86400;
const MEMBER_IDLE=7*86400000,ADMIN_IDLE=30*60000,ADMIN_MAX=12*3600000;
// Existing sessions acquire these bounds at read time; no account/data rewrite.
const validSession="s.expires_at>? AND s.created_at>?-CASE WHEN m.role='admin' THEN 43200000 ELSE 2592000000 END AND m.active=1";
export function sessionCookie(token:string,maxAge=SESSION_SECONDS){return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`}
export function tokenFromCookie(cookie:string|null){const value=(cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);return value&&/^[a-f0-9]{64}$/.test(value)?value:null}
export async function sessionUser(db:D1Database,cookie:string|null){
 const token=tokenFromCookie(cookie);if(!token)return null;const now=Date.now();
 const row=await db.prepare(`SELECT m.id,m.email,m.name,m.role,m.user_id,s.token_hash FROM auth_sessions s JOIN members m ON m.id=s.member_id JOIN auth_credentials c ON c.member_id=m.id WHERE s.token_hash=? AND ${validSession}`).bind(digest(token),now,now).first<{id:string;email:string;name:string;role:string;user_id:string|null;token_hash:string}>();
 return row?{memberId:row.id,userId:row.user_id||'member:'+row.id,email:row.email,displayName:row.name,role:row.role,tokenHash:row.token_hash}:null;
}
export async function issueSession(db:D1Database,memberId:string,credentialHash:string){
 const token=randomBytes(32).toString('hex'),now=Date.now();
 const result=await db.prepare("INSERT INTO auth_sessions(token_hash,member_id,created_at,expires_at) SELECT ?,m.id,?,?+CASE WHEN m.role='admin' THEN ? ELSE ? END FROM members m JOIN auth_credentials c ON c.member_id=m.id WHERE m.id=? AND m.active=1 AND c.password_hash=?").bind(digest(token),now,now,ADMIN_IDLE,MEMBER_IDLE,memberId,credentialHash).run();if(!result.meta.changes)return null;return token;
}
export async function renewSession(db:D1Database,cookie:string|null){
 const token=tokenFromCookie(cookie);if(!token)return null;const now=Date.now();
 const row=await db.prepare(`SELECT s.created_at,s.expires_at,m.role FROM auth_sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND ${validSession}`).bind(digest(token),now,now).first<{created_at:number;expires_at:number;role:string}>();if(!row)return null;
 const idle=row.role==='admin'?ADMIN_IDLE:MEMBER_IDLE,absolute=row.created_at+(row.role==='admin'?ADMIN_MAX:SESSION_SECONDS*1000),expires=Math.min(now+idle,absolute);
 // At most one renewal write per five minutes, including legacy long cookies.
 if(Math.abs(expires-row.expires_at)>=300000)await db.prepare('UPDATE auth_sessions SET expires_at=? WHERE token_hash=? AND expires_at>?').bind(expires,digest(token),now).run();
 return sessionCookie(token,Math.max(0,Math.floor((absolute-now)/1000)));
}
export async function revokeSession(db:D1Database,cookie:string|null){const token=tokenFromCookie(cookie);if(token)await db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(digest(token)).run()}
export async function rateLimit(db:D1Database,key:string,limit:number,windowMs:number){
 const now=Date.now(),expires=(Math.floor(now/windowMs)+1)*windowMs;
 const row=await db.prepare('INSERT INTO auth_limits(id,count,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN auth_limits.expires_at<=? THEN 1 ELSE MIN(auth_limits.count+1,?) END,expires_at=CASE WHEN auth_limits.expires_at<=? THEN excluded.expires_at ELSE auth_limits.expires_at END RETURNING count').bind(digest(key),expires,now,limit+1,now).first<{count:number}>();
 return !!row&&row.count<=limit;
}

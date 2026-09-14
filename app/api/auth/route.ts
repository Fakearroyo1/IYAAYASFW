import {env} from 'cloudflare:workers';
import {OWNER_EMAIL} from '@/lib/pilot/owner';
import {dummyHash,passwordHash,passwordMatches,same,validPassword} from '@/lib/auth/password';
import {issueSession,rateLimit,revokeSession,sessionCookie,sessionUser} from '@/lib/auth/session';
export const dynamic='force-dynamic';
const json=(value:unknown,status=200,cookie?:string)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})}});
export async function POST(request:Request){
 try{
  if(request.headers.get('origin')!==new URL(request.url).origin)return json({error:'Open the store and try again.'},403);
  if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'JSON is required.'},415);
  if(!env.DB)return json({error:'Sign-in is temporarily unavailable.'},503);
  const raw=await request.text();if(raw.length>2048)return json({error:'Request too large.'},413);let b;try{b=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}if(!b||typeof b!=='object')return json({error:'Invalid request.'},400);
  const db=env.DB;
  if(b.action==='logout'){await revokeSession(db,request.headers.get('cookie'));return json({ok:true},200,sessionCookie('',0))}
  if(b.action==='login'){
   const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';const password=typeof b.password==='string'?b.password:'';
   if(email.length>254||password.length>128||!email.includes('@'))return json({error:'Email or password was not recognized.'},401);
   const ip=request.headers.get('cf-connecting-ip')||'unknown';
   const allowed=await rateLimit(db,'ip:'+ip,40,900000)&&await rateLimit(db,'email:'+email,10,900000);
   if(!allowed)return json({error:'Too many attempts. Try again in 15 minutes.'},429);
   await db.batch([db.prepare('DELETE FROM auth_limits WHERE expires_at<?').bind(Date.now()),db.prepare('DELETE FROM auth_sessions WHERE expires_at<?').bind(Date.now())]);
   const m=await db.prepare('SELECT m.id,m.active,c.password_hash FROM members m LEFT JOIN auth_credentials c ON c.member_id=m.id WHERE lower(m.email)=?').bind(email).first<{id:string;active:number;password_hash:string|null}>();
   // Private operational diagnostics: booleans only; never log credentials or identity.
   if(!m?.password_hash)console.info('AUTH_SETUP_CHECK',JSON.stringify({
    ownerConfigured:Boolean(OWNER_EMAIL),
    ownerMatchesLogin:email===OWNER_EMAIL,
    bootstrapConfigured:typeof env.BOOTSTRAP_PASSWORD==='string'&&env.BOOTSTRAP_PASSWORD.length>0,
    bootstrapLengthValid:validPassword(env.BOOTSTRAP_PASSWORD),
    bootstrapMatchesLogin:validPassword(env.BOOTSTRAP_PASSWORD)&&same(password,env.BOOTSTRAP_PASSWORD),
    memberFound:Boolean(m),memberActive:Boolean(m?.active),
   }));
   if(m?.active&&!m.password_hash&&email===OWNER_EMAIL&&validPassword(env.BOOTSTRAP_PASSWORD)&&same(password,env.BOOTSTRAP_PASSWORD)){
    const hash=await passwordHash(password);await db.prepare('INSERT OR IGNORE INTO auth_credentials(member_id,password_hash,updated_at) VALUES(?,?,?)').bind(m.id,hash,Date.now()).run();
    m.password_hash=(await db.prepare('SELECT password_hash FROM auth_credentials WHERE member_id=?').bind(m.id).first<{password_hash:string}>())?.password_hash||null;
   }
   const matches=await passwordMatches(password,m?.password_hash||dummyHash);
   if(!m?.active||!m.password_hash||!matches)return json({error:'Email or password was not recognized.'},401);
   const token=await issueSession(db,m.id,m.password_hash);if(!token)return json({error:'Account changed. Please sign in again.'},401);
   return json({ok:true},200,sessionCookie(token));
  }
  const admin=await sessionUser(db,request.headers.get('cookie'));if(admin?.role!=='admin')return json({error:'Administrator access is required.'},403);
  if(!await rateLimit(db,'admin:'+admin.memberId,30,60000))return json({error:'Please wait a minute before trying again.'},429);
  if(typeof b.memberId!=='string'||b.memberId.length>80)return json({error:'Choose a member.'},400);
  const target=await db.prepare('SELECT id,role FROM members WHERE id=?').bind(b.memberId).first<{id:string;role:string}>();if(!target)return json({error:'Member not found.'},404);
  if(target.role==='admin'&&target.id!==admin.memberId&&admin.email.toLowerCase()!==OWNER_EMAIL)return json({error:'Only the owner can manage another administrator.'},403);
  // Recheck access in the write transaction, including after expensive password hashing.
  const accessGuard=()=>db.prepare("INSERT INTO guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM members actor JOIN members target ON target.id=? WHERE actor.id=? AND actor.active=1 AND actor.role='admin' AND (target.role<>'admin' OR target.id=actor.id OR lower(actor.email)=?)) THEN 1 ELSE 0 END)").bind(crypto.randomUUID(),b.memberId,admin.memberId,OWNER_EMAIL);
  if(b.action==='password'){
   if(!validPassword(b.password))return json({error:'Use a password between 15 and 128 characters.'},400);
   const hash=await passwordHash(b.password);
   await db.batch([accessGuard(),db.prepare('INSERT INTO auth_credentials(member_id,password_hash,updated_at) VALUES(?,?,?) ON CONFLICT(member_id) DO UPDATE SET password_hash=excluded.password_hash,updated_at=excluded.updated_at').bind(b.memberId,hash,Date.now()),db.prepare('DELETE FROM auth_sessions WHERE member_id=?').bind(b.memberId),db.prepare('INSERT INTO audit(id,actor,kind,target,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),admin.memberId,'password_assigned',b.memberId,'{}',Date.now()),db.prepare('DELETE FROM guards')]);
   return json({ok:true,signedOut:b.memberId===admin.memberId});
  }
  if(b.action==='revoke'){
   await db.batch([accessGuard(),db.prepare('DELETE FROM auth_sessions WHERE member_id=?').bind(b.memberId),db.prepare('INSERT INTO audit(id,actor,kind,target,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),admin.memberId,'sessions_revoked',b.memberId,'{}',Date.now()),db.prepare('DELETE FROM guards')]);return json({ok:true,signedOut:b.memberId===admin.memberId});
  }
  return json({error:'Unknown action.'},400);
 }catch{ return json({error:'Sign-in service is temporarily unavailable. No access was granted.'},503)}
}

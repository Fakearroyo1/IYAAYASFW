import {requireAdminAccess} from '@/lib/security/admin-access';
import {verifyChallenge} from '@/lib/security/turnstile';
import {newPasswordProblem} from '@/lib/security/password-policy';
import {readJson,RequestError} from '@/lib/security/http';
import {randomBytes} from 'node:crypto';
import {env} from 'cloudflare:workers';
import {OWNER_EMAIL} from '@/lib/pilot/owner';
import {digest,dummyHash,passwordHash,passwordMatches,same,validPassword} from '@/lib/auth/password';
import {issueSession,rateLimit,revokeSession,sessionCookie,sessionUser} from '@/lib/auth/session';
export const dynamic='force-dynamic';
const json=(value:unknown,status=200,cookie?:string)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})}});
export async function GET(){return json({siteKey:(env as any).TURNSTILE_SITE_KEY||null})}
export async function POST(request:Request){
 try{
  if(request.headers.get('origin')!==new URL(request.url).origin)return json({error:'Open the store and try again.'},403);
  if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'JSON is required.'},415);
  if(!env.DB)return json({error:'Sign-in is temporarily unavailable.'},503);
  const b=await readJson(request,4096);
  const db=env.DB;
  if(b.action==='logout'){await revokeSession(db,request.headers.get('cookie'));return json({ok:true},200,sessionCookie('',0))}
  if(b.action==='login'){
   const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';const password=typeof b.password==='string'?b.password:'';
   if(email.length>254||password.length>128||!email.includes('@'))return json({error:'Email or password was not recognized.'},401);
   const ip=request.headers.get('cf-connecting-ip')||'unknown';
   const allowed=await rateLimit(db,'ip:'+ip,40,900000)&&await rateLimit(db,'email:'+email,10,900000);
   if(!allowed)return json({error:'Too many attempts. Try again in 15 minutes.'},429);
   await verifyChallenge(request,b,env as any);
   await db.batch([db.prepare('DELETE FROM auth_limits WHERE expires_at<?').bind(Date.now()),db.prepare('DELETE FROM auth_sessions WHERE expires_at<?').bind(Date.now())]);
   const m=await db.prepare('SELECT m.id,m.active,c.password_hash FROM members m LEFT JOIN auth_credentials c ON c.member_id=m.id WHERE lower(m.email)=?').bind(email).first<{id:string;active:number;password_hash:string|null}>();
   if(m?.active&&!m.password_hash&&email===OWNER_EMAIL&&validPassword(env.BOOTSTRAP_PASSWORD)&&same(password,env.BOOTSTRAP_PASSWORD)){
    const hash=await passwordHash(password);await db.prepare('INSERT OR IGNORE INTO auth_credentials(member_id,password_hash,updated_at) VALUES(?,?,?)').bind(m.id,hash,Date.now()).run();
    m.password_hash=(await db.prepare('SELECT password_hash FROM auth_credentials WHERE member_id=?').bind(m.id).first<{password_hash:string}>())?.password_hash||null;
   }
   const matches=await passwordMatches(password,m?.password_hash||dummyHash);
   if(!m?.active||!m.password_hash||!matches)return json({error:'Email or password was not recognized.'},401);
   const token=await issueSession(db,m.id,m.password_hash);if(!token)return json({error:'Account changed. Please sign in again.'},401);
   return json({ok:true},200,sessionCookie(token));
  }
  const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
  if(['firstTime','completeSetup','requestReset','completeRecovery'].includes(b.action)){
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return json({error:'Enter a valid email address.'},400);
   const ip=request.headers.get('cf-connecting-ip')||'unknown';
   if(!await rateLimit(db,'setup-ip:'+ip,30,900000)||!await rateLimit(db,'setup-email:'+email,8,900000))return json({error:'Too many attempts. Try again in 15 minutes.'},429);
   await verifyChallenge(request,b,env as any);
   const m=await db.prepare('SELECT m.id,m.active,c.password_hash FROM members m LEFT JOIN auth_credentials c ON c.member_id=m.id WHERE lower(m.email)=?').bind(email).first<{id:string;active:number;password_hash:string|null}>();
   if(b.action==='requestReset'){
    if(m?.active&&m.password_hash)await db.prepare("INSERT OR IGNORE INTO password_reset_requests(id,member_id,created_at) VALUES(?,?,?)").bind(crypto.randomUUID(),m.id,Date.now()).run();
    return json({ok:true,message:'If this email has an active account, your request is now in the administrators’ reset queue. Contact your store administrator to receive a private recovery code.'});
   }
   const recovery=b.action==='completeRecovery',code=typeof b.code==='string'?b.code.trim():'';
   const table=recovery?'auth_recovery':'auth_setup';
   const setup=m?await db.prepare(`SELECT code_hash,expires_at FROM ${table} WHERE member_id=?`).bind(m.id).first<{code_hash:string;expires_at:number}>():null;
   if(!m?.active||(!recovery&&m.password_hash)||!setup||setup.expires_at<=Date.now()||!same(digest(code),setup.code_hash))return json({error:'The email and code could not be verified. Check the details or request a new code.'},403);
   if(b.action==='firstTime')return json({ok:true});
   if(!validPassword(b.password))return json({error:'Use a password between 15 and 128 characters.'},400);
   const problem=newPasswordProblem(b.password,email);if(problem)return json({error:problem},400);
   const hash=await passwordHash(b.password),now=Date.now();
   await db.batch([
    db.prepare(`INSERT INTO guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM members m JOIN ${table} s ON s.member_id=m.id WHERE m.id=? AND m.active=1 AND s.code_hash=? AND s.expires_at>? ${recovery?'':"AND NOT EXISTS(SELECT 1 FROM auth_credentials WHERE member_id=m.id)"}) THEN 1 ELSE 0 END)`).bind(crypto.randomUUID(),m.id,setup.code_hash,now),
    db.prepare('INSERT INTO auth_credentials(member_id,password_hash,updated_at) VALUES(?,?,?) ON CONFLICT(member_id) DO UPDATE SET password_hash=excluded.password_hash,updated_at=excluded.updated_at').bind(m.id,hash,now),
    db.prepare('DELETE FROM auth_sessions WHERE member_id=?').bind(m.id),
    db.prepare('DELETE FROM auth_setup WHERE member_id=?').bind(m.id),
    db.prepare('DELETE FROM auth_recovery WHERE member_id=?').bind(m.id),
    db.prepare("UPDATE password_reset_requests SET status='resolved',resolved_at=?,resolved_by=? WHERE member_id=? AND status='pending'").bind(now,m.id,m.id),
    db.prepare('INSERT INTO audit(id,actor,kind,target,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),m.id,recovery?'password_recovered':'account_activated',m.id,'{}',now),db.prepare('DELETE FROM guards')]);
   const token=await issueSession(db,m.id,hash);if(!token)return json({error:'Account changed. Please sign in again.'},401);
   return json({ok:true},200,sessionCookie(token));
  }
  const current=await sessionUser(db,request.headers.get('cookie'));
  if(b.action==='changePassword'){
   if(!current)return json({error:'Sign in to change your password.'},401);
   if(current.role==='admin')await requireAdminAccess(db,current);
   if(!await rateLimit(db,'password-change:'+current.memberId,8,900000))return json({error:'Too many attempts. Try again in 15 minutes.'},429);
   if(typeof b.currentPassword!=='string'||b.currentPassword.length>128||!validPassword(b.password))return json({error:'Enter your current password and a new password between 15 and 128 characters.'},400);
   const credential=await db.prepare('SELECT password_hash FROM auth_credentials WHERE member_id=?').bind(current.memberId).first<{password_hash:string}>();
   if(!credential||!await passwordMatches(b.currentPassword,credential.password_hash))return json({error:'Your current password was not recognized.'},403);
   if(same(b.currentPassword,b.password))return json({error:'Choose a different new password.'},400);
   const problem=newPasswordProblem(b.password,b.action==='changePassword'?current!.email:email);if(problem)return json({error:problem},400);
   const hash=await passwordHash(b.password),now=Date.now();
   await db.batch([
    db.prepare("INSERT INTO guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM members m JOIN auth_credentials c ON c.member_id=m.id JOIN auth_sessions s ON s.member_id=m.id WHERE m.id=? AND m.active=1 AND c.password_hash=? AND s.token_hash=? AND s.expires_at>? AND (m.role<>'admin' OR EXISTS(SELECT 1 FROM auth_admin_access a WHERE a.token_hash=s.token_hash AND a.expires_at>?))) THEN 1 ELSE 0 END)").bind(crypto.randomUUID(),current.memberId,credential.password_hash,current.tokenHash,now,now),
    db.prepare('UPDATE auth_credentials SET password_hash=?,updated_at=? WHERE member_id=?').bind(hash,now,current.memberId),
    db.prepare('DELETE FROM auth_recovery WHERE member_id=?').bind(current.memberId),
    db.prepare('DELETE FROM auth_sessions WHERE member_id=? AND token_hash<>?').bind(current.memberId,current.tokenHash),
    db.prepare("UPDATE password_reset_requests SET status='resolved',resolved_at=?,resolved_by=? WHERE member_id=? AND status='pending'").bind(now,current.memberId,current.memberId),
    db.prepare('INSERT INTO audit(id,actor,kind,target,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),current.memberId,'password_changed',current.memberId,'{}',now),db.prepare('DELETE FROM guards')]);
   return json({ok:true});
  }
  const admin=current;if(admin?.role!=='admin')return json({error:'Administrator access is required.'},403);
  await requireAdminAccess(db,admin);
  if(!await rateLimit(db,'admin:'+admin.memberId,30,60000))return json({error:'Please wait a minute before trying again.'},429);
  if(typeof b.memberId!=='string'||b.memberId.length>80)return json({error:'Choose a member.'},400);
  const target=await db.prepare('SELECT id,role,email FROM members WHERE id=?').bind(b.memberId).first<{id:string;role:string;email:string}>();if(!target)return json({error:'Member not found.'},404);
  if(target.role==='admin'&&target.id!==admin.memberId&&admin.email.toLowerCase()!==OWNER_EMAIL)return json({error:'Only the owner can manage another administrator.'},403);
  // Recheck access in the write transaction, including after expensive password hashing.
  const accessGuard=()=>db.prepare("INSERT INTO guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM members actor JOIN members target ON target.id=? WHERE actor.id=? AND actor.active=1 AND actor.role='admin' AND EXISTS(SELECT 1 FROM auth_sessions s WHERE s.member_id=actor.id AND s.token_hash=? AND s.expires_at>? AND s.created_at>? AND EXISTS(SELECT 1 FROM auth_admin_access a WHERE a.token_hash=s.token_hash AND a.expires_at>?)) AND (target.role<>'admin' OR target.id=actor.id OR lower(actor.email)=?)) THEN 1 ELSE 0 END)").bind(crypto.randomUUID(),b.memberId,admin.memberId,admin.tokenHash,Date.now(),Date.now()-12*3600000,Date.now(),OWNER_EMAIL);
  if(b.action==='issueSetup'){
   const code=randomBytes(12).toString('hex'),now=Date.now(),expiresAt=now+7*86400000;
   const eligible=await db.prepare('SELECT id FROM members WHERE id=? AND active=1 AND NOT EXISTS(SELECT 1 FROM auth_credentials WHERE member_id=members.id)').bind(target.id).first();
   if(!eligible)return json({error:'Setup codes are only for active members who have not set a password.'},400);
   await db.batch([accessGuard(),db.prepare("INSERT INTO guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM members WHERE id=? AND active=1 AND NOT EXISTS(SELECT 1 FROM auth_credentials WHERE member_id=members.id)) THEN 1 ELSE 0 END)").bind(crypto.randomUUID(),target.id),db.prepare('INSERT INTO auth_setup(member_id,code_hash,expires_at,created_by,created_at) VALUES(?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,created_by=excluded.created_by,created_at=excluded.created_at').bind(target.id,digest(code),expiresAt,admin.memberId,now),db.prepare('INSERT INTO audit(id,actor,kind,target,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),admin.memberId,'setup_code_issued',target.id,'{}',now),db.prepare('DELETE FROM guards')]);
   return json({ok:true,code,expiresAt});
  }
  if(b.action==='resolveReset'){
   await db.batch([accessGuard(),db.prepare("UPDATE password_reset_requests SET status='resolved',resolved_at=?,resolved_by=? WHERE member_id=? AND status='pending'").bind(Date.now(),admin.memberId,target.id),db.prepare('INSERT INTO audit(id,actor,kind,target,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),admin.memberId,'reset_request_resolved',target.id,'{}',Date.now()),db.prepare('DELETE FROM guards')]);return json({ok:true});
  }
  if(b.action==='issueRecovery'){
   if(b.identityVerified!==true)return json({error:'Verify the member through a known contact method before issuing a recovery code.'},400);
   const code=randomBytes(16).toString('hex'),now=Date.now(),expiresAt=now+3600000;
   await db.batch([accessGuard(),db.prepare("INSERT INTO guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM members m JOIN auth_credentials c ON c.member_id=m.id WHERE m.id=? AND m.active=1) THEN 1 ELSE 0 END)").bind(crypto.randomUUID(),target.id),db.prepare('INSERT INTO auth_recovery(member_id,code_hash,expires_at,created_by,created_at) VALUES(?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,created_by=excluded.created_by,created_at=excluded.created_at').bind(target.id,digest(code),expiresAt,admin.memberId,now),db.prepare('INSERT INTO audit(id,actor,kind,target,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),admin.memberId,'recovery_code_issued',target.id,'{"identityVerified":true}',now),db.prepare('DELETE FROM guards')]);
   return json({ok:true,code,expiresAt});
  }
  if(b.action==='password')return json({error:'Use a private setup or recovery code. Members choose their own passwords.'},400);
  if(b.action==='revoke'){
   await db.batch([accessGuard(),db.prepare('DELETE FROM auth_sessions WHERE member_id=?').bind(b.memberId),db.prepare('INSERT INTO audit(id,actor,kind,target,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),admin.memberId,'sessions_revoked',b.memberId,'{}',Date.now()),db.prepare('DELETE FROM guards')]);return json({ok:true,signedOut:b.memberId===admin.memberId});
  }
  return json({error:'Unknown action.'},400);
 }catch(e){if(e instanceof RequestError)return json({error:e.message},e.status);if(/constraint|unique/i.test(String(e)))return json({error:'Account access changed. Refresh and try again.'},409);return json({error:'Sign-in service is temporarily unavailable. No access was granted.'},503)}
}

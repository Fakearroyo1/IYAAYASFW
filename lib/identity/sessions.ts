import {createRemoteJWKSet,jwtVerify} from 'jose';
import {sessionUser,renewSession} from '../auth/session';
import {ADMIN_COOKIE,cookieValue,digest,fail,one,sql,memberGuard,atomic,audit,guard,sessionToken,type Audience,type IdentitySettings} from './common';
export type IdentityUser={memberId:string;userId:string;email:string;displayName:string;role:string;tokenHash:string;audience:Audience;epoch:number;principalId:string|null};
export async function readSession(db:D1Database,request:Request,audience:Audience):Promise<IdentityUser|null>{
 const raw=cookieValue(request,audience==='admin'?ADMIN_COOKIE:'__Host-supply-session');if(!/^[a-f0-9]{64}$/.test(raw))return null;
 const now=Date.now(),tokenHash=digest(raw);
 const row=await one<{id:string;email:string;name:string;role:string;user_id:string|null;epoch:number;principal_id:string|null;created_at:number;expires_at:number;access_expires:number|null}>(db,`SELECT m.id,m.email,m.name,m.role,m.user_id,st.epoch,i.principal_id,s.created_at,s.expires_at,aa.expires_at access_expires
 FROM auth_sessions s JOIN members m ON m.id=s.member_id JOIN identity_state st ON st.member_id=m.id
 LEFT JOIN identity_sessions i ON i.token_hash=s.token_hash LEFT JOIN auth_credentials p ON p.member_id=m.id
 LEFT JOIN identity_credentials c ON c.id=i.credential_id LEFT JOIN identity_admin_principals a ON a.id=i.principal_id
 LEFT JOIN auth_admin_access aa ON aa.token_hash=s.token_hash
 WHERE s.token_hash=? AND m.active=1 AND s.expires_at>? AND s.created_at>?-CASE WHEN m.role='admin' THEN 43200000 ELSE 2592000000 END
 AND ((i.token_hash IS NULL AND ?='member' AND p.member_id IS NOT NULL) OR
 (i.audience=? AND i.epoch=st.epoch AND i.ended_at IS NULL AND i.absolute_expires_at>? AND
 ((i.audience='member' AND c.member_id=m.id AND c.status='active') OR (i.audience='admin' AND a.member_id=m.id AND a.status='active' AND m.role='admin' AND aa.expires_at>?))))`,tokenHash,now,now,audience,audience,now,now);
 if(!row)return null;
 const absolute=row.created_at+(row.role==='admin'?43200000:2592000000),idle=row.role==='admin'?1800000:604800000;
 const expires=Math.min(now+idle,absolute,audience==='admin'?row.access_expires||0:Infinity);
 if(Math.abs(expires-row.expires_at)>=300000)await db.batch([sql(db,'UPDATE auth_sessions SET expires_at=? WHERE token_hash=? AND expires_at>?',expires,tokenHash,now),sql(db,'UPDATE identity_sessions SET last_active_at=? WHERE token_hash=? AND ended_at IS NULL',now,tokenHash)]);
 return{memberId:row.id,userId:row.user_id||'member:'+row.id,email:row.email,displayName:row.name,role:audience==='admin'?row.role:'member',tokenHash,audience,epoch:row.epoch,principalId:row.principal_id};
}
export type AccessPrincipal={id:string;member_id:string;identity_owner:number;expiresAt:number;subject:string;issuer:string};
// Once an administrator is migrated, revoking the mapping must never restore
// the old apex authority. Unmapped administrators retain their existing route
// during owner testing until their independently verified migration is ready.
export async function usesAdminHost(db:D1Database,env:IdentitySettings,memberId:string){
 return env.IDENTITY_ROLLOUT==='all-approved'||memberId===env.IDENTITY_OWNER_MEMBER_ID||!!await one(db,'SELECT 1 FROM identity_admin_principals WHERE member_id=?',memberId);
}
export async function applicationSession(db:D1Database,env:IdentitySettings,request:Request,audience:Audience){
 if(audience==='member'&&env.IDENTITY_ROLLOUT!=='all-approved'){
  const legacy=await sessionUser(db,request.headers.get('cookie'));
  if(legacy&&!(legacy.role==='admin'&&await usesAdminHost(db,env,legacy.memberId))){await renewSession(db,request.headers.get('cookie'));return legacy;}
 }
 return readSession(db,request,audience);
}
export async function accessPrincipal(db:D1Database,env:IdentitySettings,request:Request):Promise<AccessPrincipal>{
 const issuer=env.ADMIN_ACCESS_TEAM_DOMAIN||'',audience=env.IDENTITY_ADMIN_ACCESS_AUD||'',token=request.headers.get('cf-access-jwt-assertion')||'';
 if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)||!audience)fail('Administrator verification is not configured.',503);
 if(!token||token.length>16384)fail('Complete administrator verification.',403);
 try{
  const {payload}=await jwtVerify(token,createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs'),{timeoutDuration:5000}),{issuer,audience,algorithms:['RS256'],requiredClaims:['exp','iat','sub']});
  const now=Date.now();if(typeof payload.sub!=='string'||typeof payload.iat!=='number'||payload.iat*1000>now+5000||payload.iat*1000<now-1800000)fail();
  const p=await one<{id:string;member_id:string;identity_owner:number}>(db,"SELECT p.id,p.member_id,p.identity_owner FROM identity_admin_principals p JOIN members m ON m.id=p.member_id WHERE p.issuer=? AND p.subject=? AND p.status='active' AND m.active=1 AND m.role='admin'",issuer,payload.sub);
  if(!p)fail('This verified account has no administrator mapping.',403);
  return{...p!,issuer,subject:payload.sub,expiresAt:Math.min(payload.exp!*1000,payload.iat*1000+1800000)};
 }catch{fail('Administrator verification expired or is not approved. Sign in through Access again.',403);}
}
export async function adminSession(db:D1Database,principal:AccessPrincipal){
 const token=sessionToken(),hash=digest(token),now=Date.now();
 const state=await one<{epoch:number}>(db,'SELECT epoch FROM identity_state WHERE member_id=?',principal.member_id);if(!state)fail();
 await atomic(db,[memberGuard(db,principal.member_id,state!.epoch),guard(db,"EXISTS(SELECT 1 FROM identity_admin_principals p JOIN members m ON m.id=p.member_id WHERE p.id=? AND p.status='active' AND m.role='admin')",principal.id),
  sql(db,'INSERT INTO auth_sessions(token_hash,member_id,created_at,expires_at) VALUES(?,?,?,?)',hash,principal.member_id,now,Math.min(now+1800000,principal.expiresAt)),
  sql(db,"INSERT INTO identity_sessions(token_hash,member_id,audience,epoch,principal_id,auth_time,created_at,last_active_at,absolute_expires_at) VALUES(?,?,'admin',?,?,?,?,?,?)",hash,principal.member_id,state!.epoch,principal.id,now,now,now,now+43200000),
  sql(db,'INSERT INTO auth_admin_access(token_hash,subject,verified_at,expires_at) VALUES(?,?,?,?)',hash,principal.subject,now,principal.expiresAt),audit(db,principal.member_id,'admin_session_created',principal.member_id)]);
 return token;
}
export const ownerGuard=(db:D1Database,user:IdentityUser,env:IdentitySettings)=>guard(db,"EXISTS(SELECT 1 FROM identity_admin_principals p JOIN auth_admin_access a ON a.token_hash=? JOIN auth_sessions s ON s.token_hash=a.token_hash JOIN members m ON m.id=p.member_id WHERE p.id=? AND p.member_id=? AND p.member_id=? AND p.identity_owner=1 AND p.status='active' AND m.active=1 AND m.role='admin' AND s.member_id=p.member_id AND s.expires_at>? AND s.created_at>? AND a.expires_at>?)",user.tokenHash,user.principalId,user.memberId,env.IDENTITY_OWNER_MEMBER_ID||'',Date.now(),Date.now()-43200000,Date.now());
export async function requireOwner(db:D1Database,user:IdentityUser|null,env:IdentitySettings){if(!user||user.audience!=='admin'||user.memberId!==env.IDENTITY_OWNER_MEMBER_ID)fail('Only Jake can manage new identity authority.',403);await atomic(db,[ownerGuard(db,user!,env)]);return user!;}

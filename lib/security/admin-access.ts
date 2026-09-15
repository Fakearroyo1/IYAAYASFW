import {createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey} from 'jose';
import {RequestError} from './http';
type User={memberId:string;email:string;role:string;tokenHash:string};
type Config={ADMIN_ACCESS_TEAM_DOMAIN?:string;ADMIN_ACCESS_AUD?:string};
const keysets=new Map<string,JWTVerifyGetKey>();
export function accessConfig(config:Config){
 const issuer=config.ADMIN_ACCESS_TEAM_DOMAIN||'',audience=config.ADMIN_ACCESS_AUD||'';
 if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)||!audience||audience.length>255)throw new RequestError('Administrator verification has not been configured.',503);
 return{issuer,audience};
}
export async function verifyAccessToken(token:string,config:Config,email:string,keys?:JWTVerifyGetKey){
 const {issuer,audience}=accessConfig(config);
 if(!token||token.length>16384)throw new RequestError('Complete administrator verification.',403);
 let jwks=keys||keysets.get(issuer);if(!jwks){jwks=createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs'),{timeoutDuration:5000,cooldownDuration:30000});keysets.set(issuer,jwks)}
 try{
  const {payload}=await jwtVerify(token,jwks,{issuer,audience,algorithms:['RS256'],requiredClaims:['exp','iat','sub','email']});
  const now=Date.now();
  if(typeof payload.email!=='string'||payload.email.toLowerCase()!==email.toLowerCase()||typeof payload.sub!=='string'||!payload.sub||typeof payload.iat!=='number'||payload.iat*1000>now+5000||now-payload.iat*1000>30*60000)throw Error('Identity or token age mismatch');
  return{subject:payload.sub,expiresAt:Math.min(payload.exp!*1000,(payload.iat+30*60)*1000)};
 }catch{throw new RequestError('Administrator verification expired or does not match this account. Verify again.',403)}
}
export async function adminVerified(db:D1Database,user:User){
 if(user.role!=='admin')return false;const now=Date.now();
 return !!await db.prepare("SELECT 1 FROM auth_admin_access a JOIN auth_sessions s ON s.token_hash=a.token_hash JOIN members m ON m.id=s.member_id WHERE a.token_hash=? AND s.member_id=? AND a.expires_at>? AND s.expires_at>? AND s.created_at>? AND m.active=1 AND m.role='admin'").bind(user.tokenHash,user.memberId,now,now,now-12*3600000).first();
}
export async function requireAdminAccess(db:D1Database,user:User){
 if(user.role!=='admin')throw new RequestError('Administrator access is required.',403);
 if(!await adminVerified(db,user))throw new RequestError('Verify your administrator access to continue.',403);
}
export async function grantAdminAccess(db:D1Database,user:User,proof:{subject:string;expiresAt:number}){
 const now=Date.now();
 const result=await db.prepare("INSERT INTO auth_admin_access(token_hash,subject,verified_at,expires_at) SELECT s.token_hash,?,?,MIN(?,s.created_at+43200000) FROM auth_sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND s.member_id=? AND s.expires_at>? AND s.created_at>? AND m.active=1 AND m.role='admin' ON CONFLICT(token_hash) DO UPDATE SET subject=excluded.subject,verified_at=excluded.verified_at,expires_at=excluded.expires_at").bind(proof.subject,now,proof.expiresAt,user.tokenHash,user.memberId,now,now-12*3600000).run();
 if(!result.meta.changes)throw new RequestError('Sign in again before verifying administrator access.',403);
}

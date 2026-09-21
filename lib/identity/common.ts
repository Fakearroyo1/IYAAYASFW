import {randomBytes} from 'node:crypto';
import {domainToASCII} from 'node:url';
import {digest,same} from '../auth/password';
import {RequestError} from '../security/http';
import {rolloutAllowsMember} from './rollout';
export {rolloutAllowsMember};
export {digest,same};
export type Method='google'|'microsoft'|'passkey';
export type Audience='member'|'admin';
export type IdentitySettings = Partial<Record<'IDENTITY_ENABLED'|'IDENTITY_ROLLOUT'|'IDENTITY_BETA_MEMBER_IDS'|'IDENTITY_GOOGLE_ENABLED'|'IDENTITY_GOOGLE_FRESH_ENABLED'|'IDENTITY_MICROSOFT_ENABLED'|'IDENTITY_PASSKEY_ENABLED'|'IDENTITY_GOOGLE_BOOTSTRAP_ENABLED'|'IDENTITY_BASE_DOMAIN'|'IDENTITY_OWNER_MEMBER_ID'|'GOOGLE_CLIENT_ID'|'GOOGLE_CLIENT_SECRET'|'MICROSOFT_CLIENT_ID'|'MICROSOFT_CLIENT_SECRET'|'ADMIN_ACCESS_TEAM_DOMAIN'|'ADMIN_ACCESS_AUD'|'IDENTITY_ADMIN_ACCESS_AUD'|'IDENTITY_REQUEST_RETENTION_DAYS'|'IDENTITY_SESSION_RETENTION_DAYS'|'IDENTITY_AUDIT_RETENTION_DAYS',string>>;
export function fail(message='This sign-in method is not linked to enabled access. Contact a snack bar admin.',status=403):never{throw new RequestError(message,status)}
export const random=()=>randomBytes(32).toString('base64url');
export const sessionToken=()=>randomBytes(32).toString('hex');
export const id=()=>crypto.randomUUID();
export const text=(v:unknown,max=200)=>{if(typeof v!=='string'||v.length>max)fail('Enter valid text.',400);return (v as string).trim()};
export function config(env:IdentitySettings){
  const domain=env.IDENTITY_BASE_DOMAIN||'iyaayasfw.com';
  if(!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(domain))fail('Identity host configuration is invalid.',503);
  return{enabled:env.IDENTITY_ENABLED==='true',domain,member:'https://'+domain,auth:'https://auth.'+domain,register:'https://register.'+domain,admin:'https://admin.'+domain,
    methods:{google:env.IDENTITY_GOOGLE_ENABLED==='true'&&!!env.GOOGLE_CLIENT_ID&&!!env.GOOGLE_CLIENT_SECRET,microsoft:env.IDENTITY_MICROSOFT_ENABLED==='true'&&!!env.MICROSOFT_CLIENT_ID&&!!env.MICROSOFT_CLIENT_SECRET,passkey:env.IDENTITY_PASSKEY_ENABLED==='true'}};
}
export function method(value:unknown):Method{if(!['google','microsoft','passkey'].includes(String(value)))fail('Choose a sign-in method.',400);return value as Method;}
export function safeReturn(value:unknown){return typeof value==='string'&&(/^(\/|\/identity)$/.test(value)||/^\/products\/[a-zA-Z0-9_-]{1,80}$/.test(value))?value:'/';}
export function matchEmail(value:unknown){
  if(typeof value!=='string')return null;const raw=value.trim();if(raw.length>254)return null;
  const parts=raw.split('@');if(parts.length!==2)return null;
  // Intentionally reject quoted and international local parts into review.
  if(!/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/.test(parts[0])||parts[0].length>64)return null;
  if(/[/\\:?#%@\s\[\]]/.test(parts[1]))return null;
  const domain=domainToASCII(parts[1]).toLowerCase();
  if(!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain))return null;
  return parts[0]+'@'+domain;
}
export const cookieValue=(request:Request,name:string)=>{const values=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));return values.length===1?values[0].slice(name.length+1):'';};
export const cookie=(name:string,value:string,seconds=600)=>`${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
export const BROWSER='__Host-identity-browser',DESTINATION='__Host-identity-destination',ADMIN_COOKIE='__Host-supply-admin';
export const browserHash=(request:Request)=>{const token=cookieValue(request,BROWSER);if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail('Refresh this page and try again.',403);return digest(token)};
export function csrfToken(request:Request,browser=cookieValue(request,BROWSER)){return digest(browser+'|'+cookieValue(request,'__Host-supply-session')+'|'+cookieValue(request,ADMIN_COOKIE));}
export function verifyCsrf(request:Request){const origin=new URL(request.url).origin;if(request.headers.get('origin')!==origin||!cookieValue(request,BROWSER)||!same(csrfToken(request),request.headers.get('x-identity-csrf')||''))fail('Refresh this page and try again.',403);browserHash(request);}
export const sql=(db:D1Database,query:string,...values:(string|number|null)[])=>db.prepare(query).bind(...values);
export const one=<T>(db:D1Database,query:string,...values:(string|number|null)[])=>sql(db,query,...values).first<T>();
export const all=async<T>(db:D1Database,query:string,...values:(string|number|null)[])=>(await sql(db,query,...values).all<T>()).results;
export const guard=(db:D1Database,condition:string,...values:(string|number|null)[])=>sql(db,`INSERT INTO guards(id,valid) VALUES(?,CASE WHEN (${condition}) THEN 1 ELSE 0 END)`,id(),...values);
export const audit=(db:D1Database,actor:string,event:string,target:string,detail:Record<string,unknown>={})=>sql(db,'INSERT INTO identity_audit(id,actor,event,target,detail,created_at) VALUES(?,?,?,?,?,?)',id(),actor,event,target,JSON.stringify(detail),Date.now());
export async function atomic(db:D1Database,statements:D1PreparedStatement[]){try{return await db.batch([...statements,sql(db,'DELETE FROM guards')]);}catch(e){if(/constraint|unique/i.test(String(e)))fail('This request expired or the account changed. Start again.',409);throw e;}}
export type Member={id:string;name:string;email:string;role:string;epoch:number;version:number;generation:number;invalidated_at:number;user_handle:string};
export async function member(db:D1Database,memberId:string){const row=await one<Member>(db,'SELECT m.id,m.name,m.email,m.role,s.epoch,s.version,s.generation,s.invalidated_at,s.user_handle FROM members m JOIN identity_state s ON s.member_id=m.id WHERE m.id=? AND m.active=1',memberId);if(!row)fail();return row!;}
export const memberGuard=(db:D1Database,memberId:string,epoch:number)=>guard(db,'EXISTS(SELECT 1 FROM members m JOIN identity_state s ON s.member_id=m.id WHERE m.id=? AND m.active=1 AND s.epoch=?)',memberId,epoch);
export const liveSessionGuard=(db:D1Database,hash:string,memberId:string)=>guard(db,"EXISTS(SELECT 1 FROM auth_sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND m.id=? AND m.active=1 AND s.expires_at>? AND s.created_at>?-CASE WHEN m.role='admin' THEN 43200000 ELSE 2592000000 END)",hash,memberId,Date.now(),Date.now());
export type Credential={id:string;member_id:string;kind:Method;status:string;issuer:string|null;subject:string|null;client_id:string|null;observed_email:string|null;credential_id:string|null;public_key:string|null;counter:number;user_handle:string|null;rp_id:string|null;transports:string|null;label:string;created_at:number;last_used_at:number|null};
export function requireRolloutMember(env:IdentitySettings,memberId:string){if(!rolloutAllowsMember(env,memberId))fail('New sign-in methods are limited to the current test group. Use your existing password or contact the owner.',403);}
export function requireUsableMethod(env:IdentitySettings,credential:Credential){const c=config(env);if(credential.status!=='active'||!c.methods[credential.kind]||(credential.kind==='passkey'?credential.rp_id!==c.domain:credential.client_id!==(credential.kind==='google'?env.GOOGLE_CLIENT_ID:env.MICROSOFT_CLIENT_ID)))fail('This method is temporarily unavailable. Use another existing method.',503);}
export type Flow={id:string;purpose:'login'|'fresh'|'enroll';audience:Audience;destination_browser:string|null;verifier:string|null;verifier_hash:string|null;return_path:string;auth_browser:string|null;register_browser:string|null;member_id:string|null;epoch:number|null;source_session:string|null;action:string|null;grant_id:string|null;credential_id:string|null;proof:string|null;proof_at:number|null;status:string;created_at:number;expires_at:number;created_generation:number};
// Only pre-existing, currently usable credentials can prove a sensitive change.
export async function freshMethods(db:D1Database,env:IdentitySettings,f:Flow):Promise<Method[]>{
  const c=config(env),rows=await all<Credential>(db,"SELECT * FROM identity_credentials WHERE member_id=? AND status='active' AND created_at<=?",f.member_id||'',f.created_at);
  return [...new Set(rows.filter(v=>(v.kind!=='google'||env.IDENTITY_GOOGLE_FRESH_ENABLED==='true')&&c.methods[v.kind]&&(v.kind==='passkey'?v.rp_id===c.domain:v.client_id===(v.kind==='google'?env.GOOGLE_CLIENT_ID:env.MICROSOFT_CLIENT_ID))).map(v=>v.kind))];
}
export async function flow(db:D1Database,flowId:string){const f=await one<Flow>(db,"SELECT * FROM identity_flows WHERE id=? AND status IN ('pending','proven') AND expires_at>?",flowId,Date.now());if(!f)fail('This sign-in request expired. Start again.',409);return f!;}
export const flowGuard=(db:D1Database,f:Flow)=>guard(db,"EXISTS(SELECT 1 FROM identity_flows WHERE id=? AND status=? AND expires_at>?)",f.id,f.status,Date.now());

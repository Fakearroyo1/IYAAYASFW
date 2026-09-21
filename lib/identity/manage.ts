import {requireRolloutMember,rolloutAllowsMember,fail,id,random,digest,config,sql,one,all,guard,atomic,audit,member,memberGuard,liveSessionGuard,matchEmail,text,type IdentitySettings,type Credential} from './common';
import {ownerGuard,requireOwner,type IdentityUser} from './sessions';
import {credentialInsert,grantGuard,type Grant} from './flows';
import type {ProviderProof} from './providers';

function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));return value;}
export const payloadHash=(payload:unknown)=>digest(JSON.stringify(canonical(payload)));
export async function approval(db:D1Database,user:IdentityUser,grantId:string,purpose:string){
 const g=await one<Grant>(db,"SELECT * FROM identity_grants WHERE id=? AND kind='action' AND purpose=? AND member_id=? AND source_session=? AND status='pending' AND expires_at>? AND proof_at>?",grantId,purpose,user.memberId,user.tokenHash,Date.now(),Date.now()-300000);
 if(!g||g.epoch!==user.epoch)fail('Verify an existing sign-in method for this exact action.',403);
 return [memberGuard(db,user.memberId,user.epoch),liveSessionGuard(db,user.tokenHash,user.memberId),grantGuard(db,g!),...(g!.proof_credential?[guard(db,"EXISTS(SELECT 1 FROM identity_credentials WHERE id=? AND status='active')",g!.proof_credential)]:[]),sql(db,"UPDATE identity_grants SET status='consumed',consumed_at=?,version=version+1 WHERE id=?",Date.now(),g!.id)];
}
export async function ownMethods(db:D1Database,user:IdentityUser){
 const methods=await all(db,'SELECT id,kind,status,label,observed_email,created_at,last_used_at FROM identity_credentials WHERE member_id=? ORDER BY created_at DESC',user.memberId);
 const sessions=await all<{token_hash:string;created_at:number;expires_at:number;audience:string|null;kind:string|null}>(db,'SELECT s.token_hash,s.created_at,s.expires_at,i.audience,c.kind FROM auth_sessions s LEFT JOIN identity_sessions i ON i.token_hash=s.token_hash LEFT JOIN identity_credentials c ON c.id=i.credential_id WHERE s.member_id=? AND s.expires_at>? ORDER BY s.created_at DESC LIMIT 100',user.memberId,Date.now());
 return{methods,sessions:sessions.map(({token_hash,...s})=>({...s,id:digest('display:'+token_hash),current:token_hash===user.tokenHash})),hasPassword:!!await one(db,'SELECT 1 FROM auth_credentials WHERE member_id=?',user.memberId)};
}
export async function ownMutation(db:D1Database,env:IdentitySettings,user:IdentityUser,body:Record<string,unknown>){
 const action=text(body.operation,40),target=typeof body.target==='string'?text(body.target,100):'',now=Date.now();
 const statements=[memberGuard(db,user.memberId,user.epoch),liveSessionGuard(db,user.tokenHash,user.memberId)];
 if(action==='rename'){
  const label=text(body.label,80);if(!label)fail('Enter a name for this passkey.',400);
  statements.push(guard(db,"EXISTS(SELECT 1 FROM identity_credentials WHERE id=? AND member_id=? AND kind='passkey' AND status='active')",target,user.memberId),sql(db,'UPDATE identity_credentials SET label=? WHERE id=? AND member_id=?',label,target,user.memberId),audit(db,user.memberId,'passkey_renamed',user.memberId,{credentialId:target}));
 }else if(action==='unlink'){
  statements.push(...await approval(db,user,text(body.approval,80),'unlink:'+target));
  const enabled=config(env).methods;
  statements.push(guard(db,"EXISTS(SELECT 1 FROM identity_credentials WHERE id=? AND member_id=? AND status='active')",target,user.memberId),guard(db,"EXISTS(SELECT 1 FROM auth_credentials WHERE member_id=?) OR EXISTS(SELECT 1 FROM identity_credentials WHERE member_id=? AND id<>? AND status='active' AND ((kind='google' AND ?=1 AND client_id=?) OR (kind='microsoft' AND ?=1 AND client_id=?) OR (kind='passkey' AND ?=1 AND rp_id=?)))",user.memberId,user.memberId,target,enabled.google?1:0,env.GOOGLE_CLIENT_ID||'',enabled.microsoft?1:0,env.MICROSOFT_CLIENT_ID||'',enabled.passkey?1:0,config(env).domain),sql(db,"UPDATE identity_credentials SET status='revoked',revoked_at=? WHERE id=?",now,target),audit(db,user.memberId,'method_unlinked',user.memberId,{credentialId:target}));
 }else if(action==='logoutAll'){
  statements.push(sql(db,'UPDATE identity_state SET epoch=epoch+1,version=version+1 WHERE member_id=?',user.memberId),sql(db,'DELETE FROM auth_sessions WHERE member_id=?',user.memberId),audit(db,user.memberId,'all_sessions_revoked',user.memberId));
 }else if(action==='logout'||action==='revokeSession'){
  const sessions=await all<{token_hash:string}>(db,'SELECT token_hash FROM auth_sessions WHERE member_id=?',user.memberId);
  const hash=action==='logout'?user.tokenHash:sessions.find(s=>digest('display:'+s.token_hash)===target)?.token_hash;if(!hash)fail('Session not found.',404);
  statements.push(sql(db,'DELETE FROM auth_sessions WHERE token_hash=? AND member_id=?',hash!,user.memberId),audit(db,user.memberId,'session_revoked',user.memberId));
 }else fail('Unknown account action.',400);
 await atomic(db,statements);return{ok:true};
}
export async function adminRead(db:D1Database,env:IdentitySettings,user:IdentityUser|null,query:string,target?:string){
 const actor=await requireOwner(db,user,env);
 if(target){
  const m=await one(db,'SELECT m.id,m.name,m.email,m.active,m.role,s.epoch,s.version,c.email contact_email FROM members m JOIN identity_state s ON s.member_id=m.id LEFT JOIN identity_contacts c ON c.member_id=m.id WHERE m.id=?',target);if(!m)fail('Member not found.',404);
  return{member:{...m,rolloutEligible:rolloutAllowsMember(env,target)},methods:await all(db,'SELECT id,kind,status,label,observed_email,created_at,last_used_at,provenance FROM identity_credentials WHERE member_id=? ORDER BY created_at DESC',target),grants:await all(db,'SELECT id,kind,purpose,provider,match_email,status,expires_at,created_at,result_credential FROM identity_grants WHERE member_id=? ORDER BY created_at DESC LIMIT 100',target),events:await all(db,'SELECT event,detail,created_at FROM identity_audit WHERE target=? ORDER BY created_at DESC LIMIT 50',target)};
 }
 return{members:await all(db,"SELECT m.id,m.name,m.email,m.role,m.active,s.version FROM members m JOIN identity_state s ON s.member_id=m.id WHERE m.id=? OR instr(lower(m.name),lower(?))>0 OR instr(lower(m.email),lower(?))>0 ORDER BY m.name LIMIT 60",query,query,query),requests:await all(db,"SELECT id,provider,observed_email,created_at,attempts FROM identity_requests WHERE state='pending' ORDER BY created_at LIMIT 100"),owner:actor.memberId};
}
export async function adminMutation(db:D1Database,env:IdentitySettings,user:IdentityUser|null,payload:Record<string,unknown>,grantId:string){
 const actor=await requireOwner(db,user,env),op=text(payload.operation,40),target=text(payload.target,80),now=Date.now();
 const base=[ownerGuard(db,actor,env),...await approval(db,actor,grantId,'owner:'+payloadHash(payload))];
 if(op==='revokeGrant'){
  await atomic(db,[...base,sql(db,"UPDATE identity_grants SET status='revoked',version=version+1 WHERE id=? AND status='pending'",target),audit(db,actor.memberId,'grant_revoked',target)]);return{ok:true};
 }
 if(op==='reviewReject'||op==='reviewBlock'){
  const reason=text(payload.reason,200);if(!reason)fail('Record the verification result.',400);
  await atomic(db,[...base,guard(db,"EXISTS(SELECT 1 FROM identity_requests WHERE id=? AND state='pending')",target),sql(db,'UPDATE identity_requests SET state=?,reviewed_by=?,reviewed_at=?,reason=? WHERE id=?',op==='reviewBlock'?'blocked':'rejected',actor.memberId,now,reason,target),audit(db,actor.memberId,op,target,{reason})]);return{ok:true};
 }
 const m=await member(db,target);base.push(memberGuard(db,m.id,m.epoch));
 if(op==='invite'){
  requireRolloutMember(env,m.id);
  const purpose=payload.purpose==='recovery'?'recovery':'enroll';
  const seconds=payload.seconds===undefined?86400:Number(payload.seconds);if(!Number.isInteger(seconds)||seconds<900||seconds>604800)fail('Choose 15 minutes, one day, or up to seven days.',400);
  if(payload.identityVerified!==true)fail('Confirm the member through a known contact method first.',400);
  const token=random(),grant=id();
  await atomic(db,[...base,sql(db,"UPDATE identity_grants SET status='revoked',version=version+1 WHERE member_id=? AND kind='invite' AND purpose=? AND status='pending'",m.id,purpose),sql(db,"INSERT INTO identity_grants(id,member_id,kind,purpose,token_hash,epoch,created_by,created_at,expires_at) VALUES(?,?,'invite',?,?,?,?,?,?)",grant,m.id,purpose,digest(token),m.epoch,actor.memberId,now,now+seconds*1000),audit(db,actor.memberId,'invite_issued',m.id,{grantId:grant,purpose,seconds})]);return{ok:true,url:config(env).register+'/identity#invite='+encodeURIComponent(token),expiresAt:now+seconds*1000,memberId:m.id,memberName:m.name};
 }
 if(op==='bootstrap'){
  const provider=payload.provider;if(provider!=='google'&&provider!=='microsoft')fail('Choose a provider.',400);
  const raw=text(payload.email,254),email=matchEmail(raw);if(!email)fail('Use an ordinary email address or issue an invitation.',400);
  const grant=id();await atomic(db,[...base,sql(db,"INSERT INTO identity_grants(id,member_id,kind,purpose,provider,match_email,raw_email,epoch,created_by,created_at,expires_at) VALUES(?,?,'bootstrap','first-association',?,?,?,?,?,?,?)",grant,m.id,provider as string,email,raw,m.epoch,actor.memberId,now,now+90*86400000),audit(db,actor.memberId,'bootstrap_issued',m.id,{grantId:grant,provider})]);return{ok:true};
 }
 if(op==='reviewLink'){
  const requestId=text(payload.requestId,80),reason=text(payload.reason,200);if(!reason||payload.identityVerified!==true)fail('Record independent identity verification first.',400);
  const pending=await one<{provider:'google'|'microsoft';issuer:string;subject:string;client_id:string;observed_email:string|null;tenant_id:string|null;object_id:string|null}>(db,"SELECT * FROM identity_requests WHERE id=? AND state='pending'",requestId);if(!pending)fail('This request is no longer pending.',409);
  const proof:ProviderProof={kind:pending!.provider,issuer:pending!.issuer,subject:pending!.subject,clientId:pending!.client_id,email:pending!.observed_email,bootstrapEmail:null,tenant:pending!.tenant_id,objectId:pending!.object_id,authTime:now},insert=credentialInsert(db,m.id,proof,'review:'+requestId);
  await atomic(db,[...base,guard(db,"EXISTS(SELECT 1 FROM identity_requests WHERE id=? AND state='pending')",requestId),insert.statement,sql(db,"UPDATE identity_requests SET state='linked',reviewed_at=?,reviewed_by=?,member_id=?,reason=? WHERE id=?",now,actor.memberId,m.id,reason,requestId),sql(db,'UPDATE identity_state SET version=version+1 WHERE member_id=?',m.id),audit(db,actor.memberId,'review_linked',m.id,{requestId,credentialId:insert.credentialId,reason})]);return{ok:true,message:'Linked. The member must sign in again; no existing browser was signed in.'};
 }
 if(op==='revokeMethod'){
  const credentialId=text(payload.credentialId,80),reason=text(payload.reason,200);if(!reason)fail('Record a reason.',400);
  if(m.id===actor.memberId)fail('Use your own sign-in settings to remove a method safely.',400);
  await atomic(db,[...base,guard(db,"EXISTS(SELECT 1 FROM identity_credentials WHERE id=? AND member_id=? AND status='active')",credentialId,m.id),sql(db,"UPDATE identity_credentials SET status='revoked',revoked_at=? WHERE id=? AND member_id=?",now,credentialId,m.id),audit(db,actor.memberId,'method_revoked',m.id,{credentialId,reason})]);return{ok:true};
 }
 if(op==='contain'||op==='revokeSessions'){
  const reason=text(payload.reason,200);if(!reason)fail('Record a reason.',400);
  if(op==='contain'&&m.id===env.IDENTITY_OWNER_MEMBER_ID)fail('Owner containment requires the independent recovery runbook.',400);
  await atomic(db,[...base,...(op==='contain'?[sql(db,'UPDATE members SET active=0 WHERE id=?',m.id)]:[sql(db,'UPDATE identity_state SET epoch=epoch+1,version=version+1 WHERE member_id=?',m.id)]),sql(db,'DELETE FROM auth_sessions WHERE member_id=?',m.id),audit(db,actor.memberId,op,m.id,{reason})]);return{ok:true};
 }
 if(op==='contact'){
  const email=text(payload.email,254);if(!matchEmail(email))fail('Enter a supported contact address.',400);
  await atomic(db,[...base,sql(db,'INSERT INTO identity_contacts(member_id,email,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET email=excluded.email,updated_at=excluded.updated_at,updated_by=excluded.updated_by',m.id,email,now,actor.memberId),sql(db,'UPDATE identity_state SET version=version+1 WHERE member_id=?',m.id),audit(db,actor.memberId,'contact_updated',m.id)]);return{ok:true};
 }
 fail('Unknown identity action.',400);
}

import {passwordMatches} from '../auth/password';
import {rateLimit} from '../auth/session';
import {config,fail,random,sessionToken,digest,same,id,sql,one,all,atomic,guard,audit,member,memberGuard,liveSessionGuard,flow,flowGuard,safeReturn,requireRolloutMember,requireUsableMethod,type Flow,type Method,type Credential,type IdentitySettings} from './common';
import type {ProviderProof,PasskeyProof} from './providers';
import type {IdentityUser} from './sessions';
export type Grant={id:string;member_id:string;kind:string;purpose:string;provider:Method|null;status:string;epoch:number;source_session:string|null;proof_credential:string|null;proof_at:number|null;flow_id:string|null;expires_at:number;version:number};
export function credentialInsert(db:D1Database,memberId:string,proof:ProviderProof|PasskeyProof,provenance:string,label?:string){
 const credentialId=id(),now=Date.now();
 const statement=proof.kind==='passkey'?sql(db,"INSERT INTO identity_credentials(id,member_id,kind,credential_id,public_key,counter,user_handle,rp_id,transports,backed_up,device_type,label,provenance,created_at,last_used_at) VALUES(?,?,'passkey',?,?,?,?,?,?,?,?,?,?,?,?)",credentialId,memberId,proof.credentialId,proof.publicKey,proof.counter,proof.userHandle,proof.rpId,JSON.stringify(proof.transports),proof.backedUp?1:0,proof.deviceType,label||'My passkey',provenance,now,now):
 sql(db,'INSERT INTO identity_credentials(id,member_id,kind,issuer,subject,client_id,observed_email,tenant_id,object_id,label,provenance,created_at,last_used_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',credentialId,memberId,proof.kind,proof.issuer,proof.subject,proof.clientId,proof.email,proof.tenant,proof.objectId,label||proof.kind,provenance,now,now);
 return{credentialId,statement};
}
export async function newFlow(db:D1Database,destinationBrowser:string,returnPath:unknown,user?:IdentityUser,action?:string,payload?:unknown){
 const flowId=random(),verifier=random(),now=Date.now();
 if(action&&!/^(add:(google|microsoft|passkey)|unlink:[a-f0-9-]{36}|owner:[a-f0-9]{64})$/.test(action))fail('Choose an account action.',400);
 if(action&&!user)fail('Sign in first.',401);
 await atomic(db,[...(user?[memberGuard(db,user.memberId,user.epoch),liveSessionGuard(db,user.tokenHash,user.memberId)]:[]),sql(db,'INSERT INTO identity_flows(id,purpose,audience,destination_browser,verifier,verifier_hash,return_path,member_id,epoch,source_session,action,action_payload,created_at,expires_at,created_generation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT generation FROM identity_clock WHERE id=1))',flowId,action?'fresh':'login',user?.audience||'member',destinationBrowser,verifier,digest(verifier),safeReturn(returnPath),user?.memberId||null,user?.epoch??null,action?user!.tokenHash:null,action||null,payload?JSON.stringify(payload):null,now,now+600000)]);return flowId;
}
export async function adoptFlow(db:D1Database,flowId:string,browser:string,host:'auth'|'register'){
 const f=await flow(db,flowId),field=host==='auth'?'auth_browser':'register_browser';
 if(f[field]&&!same(f[field]!,browser))fail('Continue in the browser where you started.',403);
 await atomic(db,[flowGuard(db,f),guard(db,`EXISTS(SELECT 1 FROM identity_flows WHERE id=? AND (${field} IS NULL OR ${field}=?))`,f.id,browser),sql(db,`UPDATE identity_flows SET ${field}=? WHERE id=?`,browser,f.id)]);return{...f,[field]:browser};
}
export async function boundFlow(db:D1Database,flowId:string,browser:string,host:'auth'|'register'){
 const f=await flow(db,flowId);if(!f[host==='auth'?'auth_browser':'register_browser']||!same(f[host==='auth'?'auth_browser':'register_browser']!,browser))fail('Continue in the browser where you started.',403);return f;
}
export async function grantFor(db:D1Database,f:Flow){
 const g=await one<Grant>(db,"SELECT * FROM identity_grants WHERE id=? AND status='pending' AND expires_at>?",f.grant_id||'',Date.now());
 if(!g||g.member_id!==f.member_id||g.epoch!==f.epoch||g.kind==='bootstrap'||g.flow_id&&g.flow_id!==f.id)fail('This invitation or approval expired. Start again.',409);
 if(g!.kind==='enrollment'&&(!g!.proof_at||g!.proof_at<Date.now()-300000))fail('Verify an existing method again.',403);
 await member(db,g!.member_id);return g!;
}
export const grantGuard=(db:D1Database,g:Grant)=>guard(db,"EXISTS(SELECT 1 FROM identity_grants WHERE id=? AND member_id=? AND epoch=? AND version=? AND status='pending' AND expires_at>?)",g.id,g.member_id,g.epoch,g.version,Date.now());
export async function claimInvite(db:D1Database,token:string,browser:string){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail('This invitation is unavailable. Ask Jake for a new one.',403);
 const grant=await one<Grant>(db,"SELECT * FROM identity_grants WHERE token_hash=? AND kind='invite' AND status='pending' AND expires_at>?",digest(token),Date.now());if(!grant)fail('This invitation is unavailable. Ask Jake for a new one.',403);
 const m=await member(db,grant!.member_id);if(grant!.epoch!==m.epoch)fail();
 const flowId=random(),now=Date.now();
 await atomic(db,[memberGuard(db,m.id,m.epoch),grantGuard(db,grant!),sql(db,"INSERT INTO identity_flows(id,purpose,register_browser,member_id,epoch,grant_id,created_at,expires_at) VALUES(?,'enroll',?,?,?,?,?,?)",flowId,browser,m.id,m.epoch,grant!.id,now,Math.min(now+600000,grant!.expires_at))]);
 return flowId;
}
export async function bridgeInvite(db:D1Database,flowId:string,destinationBrowser:string,user:IdentityUser|null){
 const f=await flow(db,flowId);if(f.purpose!=='enroll'||!f.register_browser)fail();
 if(user&&user.memberId!==f.member_id)fail('This invitation belongs to another member. Sign out explicitly before continuing.',409);
 if(f.destination_browser&&!same(f.destination_browser,destinationBrowser))fail();
 const verifier=random(),g=await grantFor(db,f);
 await atomic(db,[flowGuard(db,f),grantGuard(db,g),memberGuard(db,g.member_id,g.epoch),guard(db,'EXISTS(SELECT 1 FROM identity_flows WHERE id=? AND destination_browser IS NULL)',f.id),sql(db,'UPDATE identity_flows SET destination_browser=?,verifier=?,verifier_hash=? WHERE id=?',destinationBrowser,verifier,digest(verifier),f.id)]);return f.id;
}
export async function associateProvider(db:D1Database,env:IdentitySettings,proof:ProviderProof,f:Flow):Promise<Credential|null>{
 const linked=await one<Credential>(db,'SELECT * FROM identity_credentials WHERE issuer=? AND subject=?',proof.issuer,proof.subject);
 if(linked){if(linked.status!=='active'||linked.kind!==proof.kind||linked.client_id!==proof.clientId)fail();requireRolloutMember(env,linked.member_id);requireUsableMethod(env,linked);await member(db,linked.member_id);return linked;}
 const review=await one<{state:string}>(db,'SELECT state FROM identity_requests WHERE issuer=? AND subject=?',proof.issuer,proof.subject);
 if(review&&review.state!=='pending')fail();
 // Microsoft bootstrap deliberately has no enable path until its separate gate.
 const eligible=proof.kind==='google'&&env.IDENTITY_GOOGLE_BOOTSTRAP_ENABLED==='true'&&proof.bootstrapEmail;
 const g=eligible?await one<Grant>(db,"SELECT * FROM identity_grants WHERE kind='bootstrap' AND provider=? AND match_email=? AND status='pending' AND expires_at>?",proof.kind,proof.bootstrapEmail!,Date.now()):null;
 if(g){requireRolloutMember(env,g.member_id);const m=await member(db,g.member_id);if(m.epoch!==g.epoch||f.created_generation<m.generation)fail();const insert=credentialInsert(db,m.id,proof,'bootstrap:'+g.id);
  await atomic(db,[flowGuard(db,f),memberGuard(db,m.id,m.epoch),guard(db,'EXISTS(SELECT 1 FROM identity_state WHERE member_id=? AND generation<=?)',m.id,f.created_generation),grantGuard(db,g),guard(db,"NOT EXISTS(SELECT 1 FROM identity_requests WHERE issuer=? AND subject=? AND state<>'pending')",proof.issuer,proof.subject),insert.statement,sql(db,"UPDATE identity_grants SET status='consumed',version=version+1,consumed_at=?,result_credential=? WHERE id=?",Date.now(),insert.credentialId,g.id),audit(db,m.id,'bootstrap_claimed',m.id,{grantId:g.id,credentialId:insert.credentialId,provider:proof.kind})]);
  return (await one<Credential>(db,'SELECT * FROM identity_credentials WHERE id=?',insert.credentialId))!;
 }
 // Bounded valid-proof review queue. Tokens and complete claims are discarded.
 if(!review&&(await one<{n:number}>(db,"SELECT count(*) n FROM identity_requests WHERE state='pending'"))!.n>=1000)fail('Sign-in needs review. Contact Jake.',429);
 await sql(db,"INSERT INTO identity_requests(id,provider,issuer,subject,client_id,observed_email,tenant_id,object_id,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(issuer,subject) DO UPDATE SET attempts=MIN(identity_requests.attempts+1,1000),last_seen_at=excluded.last_seen_at,observed_email=excluded.observed_email WHERE identity_requests.state='pending'",id(),proof.kind,proof.issuer,proof.subject,proof.clientId,proof.email,proof.tenant,proof.objectId,Date.now(),Date.now()).run();return null;
}
export async function storeEnrollmentProof(db:D1Database,f:Flow,proof:ProviderProof|PasskeyProof){
 if(f.purpose!=='enroll'||!f.destination_browser||!f.register_browser)fail();
 const g=await grantFor(db,f);if(g.kind==='enrollment'&&g.purpose!=='add:'+proof.kind||g.provider&&g.provider!==proof.kind)fail();
 if(proof.kind!=='passkey'){
  if(await one(db,'SELECT 1 FROM identity_credentials WHERE issuer=? AND subject=?',proof.issuer,proof.subject)||await one(db,"SELECT 1 FROM identity_requests WHERE issuer=? AND subject=? AND state IN ('blocked','rejected')",proof.issuer,proof.subject))fail('This method is already linked or reserved. Contact Jake.',409);
 }
 await atomic(db,[flowGuard(db,f),memberGuard(db,g.member_id,g.epoch),grantGuard(db,g),sql(db,"UPDATE identity_flows SET proof=?,proof_at=?,status='proven' WHERE id=?",JSON.stringify(proof),Date.now(),f.id)]);
}
export async function finishEnrollment(db:D1Database,f:Flow,label:string){
 const g=await grantFor(db,f);if(f.status!=='proven'||!f.proof||!f.proof_at||f.proof_at<Date.now()-300000)fail('This proof expired. Start again.',409);
 const proof=JSON.parse(f.proof!) as ProviderProof|PasskeyProof,insert=credentialInsert(db,g.member_id,proof,g.kind+':'+g.id,label||undefined);
 const conditions=[flowGuard(db,f),memberGuard(db,g.member_id,g.epoch),grantGuard(db,g)];
 if(g.source_session)conditions.push(liveSessionGuard(db,g.source_session,g.member_id));
 if(g.proof_credential)conditions.push(guard(db,"EXISTS(SELECT 1 FROM identity_credentials WHERE id=? AND member_id=? AND status='active')",g.proof_credential,g.member_id));
 if(proof.kind!=='passkey')conditions.push(guard(db,"NOT EXISTS(SELECT 1 FROM identity_requests WHERE issuer=? AND subject=? AND state IN ('rejected','blocked'))",proof.issuer,proof.subject));
 await atomic(db,[...conditions,insert.statement,sql(db,"UPDATE identity_grants SET status='consumed',version=version+1,consumed_at=?,result_credential=? WHERE id=?",Date.now(),insert.credentialId,g.id),sql(db,'UPDATE identity_flows SET credential_id=?,proof=NULL WHERE id=?',insert.credentialId,f.id),sql(db,'UPDATE identity_state SET version=version+1 WHERE member_id=?',g.member_id),audit(db,g.member_id,'method_enrolled',g.member_id,{grantId:g.id,credentialId:insert.credentialId,kind:proof.kind})]);
 return (await one<Credential>(db,'SELECT * FROM identity_credentials WHERE id=?',insert.credentialId))!;
}
export async function freshPassword(db:D1Database,f:Flow,password:string){
 if(f.purpose!=='fresh'||!f.member_id||!f.source_session)fail();
 if(!await rateLimit(db,'identity-password:'+f.member_id,8,900000))fail('Too many attempts. Try again later.',429);
 const stored=await one<{password_hash:string}>(db,'SELECT password_hash FROM auth_credentials WHERE member_id=?',f.member_id);
 if(password.length>128||!stored||!await passwordMatches(password,stored.password_hash))fail('The existing password was not recognized.',403);
 await atomic(db,[flowGuard(db,f),memberGuard(db,f.member_id,f.epoch!),liveSessionGuard(db,f.source_session,f.member_id),guard(db,'EXISTS(SELECT 1 FROM auth_credentials WHERE member_id=? AND password_hash=?)',f.member_id,stored.password_hash),sql(db,"UPDATE identity_flows SET status='proven',proof_at=? WHERE id=?",Date.now(),f.id)]);
}
export async function authenticated(db:D1Database,f:Flow,credential:Credential,proofTime=Date.now()){
 const m=await member(db,credential.member_id);if(f.purpose==='enroll')fail();
 if(f.created_generation<m.generation)fail('Account access changed. Start sign-in again.',409);
 if(f.purpose==='fresh'&&(f.member_id!==m.id||f.epoch!==m.epoch||!f.source_session||proofTime<Date.now()-300000||credential.created_at>f.created_at))fail('Use a method already linked to this account.',403);
 await atomic(db,[flowGuard(db,f),memberGuard(db,m.id,m.epoch),guard(db,'EXISTS(SELECT 1 FROM identity_state WHERE member_id=? AND generation<=?)',m.id,f.created_generation),guard(db,"EXISTS(SELECT 1 FROM identity_credentials WHERE id=? AND member_id=? AND status='active')",credential.id,m.id),...(f.source_session?[liveSessionGuard(db,f.source_session,m.id)]:[]),sql(db,"UPDATE identity_flows SET status='proven',member_id=?,epoch=?,credential_id=?,proof_at=? WHERE id=?",m.id,m.epoch,credential.id,proofTime,f.id),sql(db,'UPDATE identity_credentials SET last_used_at=? WHERE id=?',Date.now(),credential.id)]);
}
export async function issueHandoff(db:D1Database,env:IdentitySettings,flowId:string){
 const f=await flow(db,flowId);if(f.status!=='proven'||!f.member_id||f.epoch===null||!f.destination_browser||!f.verifier||!f.verifier_hash)fail();
 requireRolloutMember(env,f.member_id);
 if(f.credential_id){const credential=await one<Credential>(db,'SELECT * FROM identity_credentials WHERE id=?',f.credential_id);if(!credential)fail();requireUsableMethod(env,credential);}
 const c=config(env),code=random(),now=Date.now(),callback=(f.audience==='admin'?c.admin:c.member)+'/identity';
 await atomic(db,[flowGuard(db,f),memberGuard(db,f.member_id!,f.epoch!),...(f.credential_id?[guard(db,"EXISTS(SELECT 1 FROM identity_credentials WHERE id=? AND status='active')",f.credential_id)]:[]),sql(db,'INSERT INTO identity_handoffs(code_hash,flow_id,member_id,credential_id,epoch,purpose,callback,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',digest(code),f.id,f.member_id!,f.credential_id,f.epoch!,f.purpose,callback,now,Math.min(now+60000,f.expires_at))]);
 return callback+'#code='+encodeURIComponent(code)+'&flow='+encodeURIComponent(f.id);
}
export async function redeem(db:D1Database,env:IdentitySettings,flowId:string,code:string,destinationBrowser:string,audience:'member'|'admin',existing:IdentityUser|null){
 const f=await flow(db,flowId),c=config(env),now=Date.now();
 requireRolloutMember(env,f.member_id||'');
 if(f.credential_id){const credential=await one<Credential>(db,'SELECT * FROM identity_credentials WHERE id=?',f.credential_id);if(!credential)fail();requireUsableMethod(env,credential);}
 if(!f.destination_browser||!same(f.destination_browser,destinationBrowser)||!f.verifier||!f.verifier_hash||!same(digest(f.verifier),f.verifier_hash)||f.audience!==audience||f.status!=='proven')fail('Return to the browser where sign-in started.',403);
 if(existing&&existing.memberId!==f.member_id)fail('A different member is signed in. Sign out explicitly first.',409);
 const m=await member(db,f.member_id!),statements=[flowGuard(db,f),memberGuard(db,m.id,f.epoch!),guard(db,'EXISTS(SELECT 1 FROM identity_handoffs WHERE code_hash=? AND flow_id=? AND member_id=? AND epoch=? AND purpose=? AND callback=? AND consumed_at IS NULL AND expires_at>?)',digest(code),f.id,m.id,f.epoch!,f.purpose,(audience==='admin'?c.admin:c.member)+'/identity',now)];
 if(f.credential_id)statements.push(guard(db,"EXISTS(SELECT 1 FROM identity_credentials WHERE id=? AND member_id=? AND status='active')",f.credential_id,m.id));
 let token:string|null=null,next=f.return_path;
 if(f.purpose==='fresh'){
  if(!f.source_session||!f.action||!f.proof_at||f.proof_at<now-300000)fail('Verify an existing method again.',403);
  statements.push(liveSessionGuard(db,f.source_session!,m.id));
  const grantId=id(),enroll=f.action!.startsWith('add:'),nextFlow=random();
  statements.push(sql(db,'INSERT INTO identity_grants(id,member_id,kind,purpose,provider,epoch,source_session,proof_credential,proof_at,flow_id,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',grantId,m.id,enroll?'enrollment':'action',f.action!,enroll?f.action!.slice(4):null,m.epoch,f.source_session,f.credential_id,f.proof_at,enroll?nextFlow:f.id,m.id,now,Math.min(f.proof_at!+300000,now+300000)));
  if(enroll){
   if(!f.register_browser)fail('Start the addition from the registration page.',403);
   const verifier=random();
   statements.push(sql(db,"INSERT INTO identity_flows(id,purpose,audience,destination_browser,verifier,verifier_hash,return_path,register_browser,member_id,epoch,grant_id,created_at,expires_at) VALUES(?,'enroll',?,?,?,?,?,?,?,?,?,?,?)",nextFlow,audience,destinationBrowser,verifier,digest(verifier),'/identity',f.register_browser,m.id,m.epoch,grantId,now,Math.min(now+300000,f.proof_at!+300000)));
   next=c.register+'/identity?flow='+encodeURIComponent(nextFlow);
  }else next='/identity?approval='+encodeURIComponent(grantId);
 }else{
  if(audience!=='member'||!f.credential_id)fail();
  token=sessionToken();const hash=digest(token),absolute=now+(m.role==='admin'?43200000:2592000000),idle=m.role==='admin'?1800000:604800000;
  if(existing)statements.push(sql(db,'DELETE FROM auth_sessions WHERE token_hash=?',existing.tokenHash));
  statements.push(sql(db,'INSERT INTO auth_sessions(token_hash,member_id,created_at,expires_at) VALUES(?,?,?,?)',hash,m.id,now,now+idle),sql(db,"INSERT INTO identity_sessions(token_hash,member_id,audience,epoch,credential_id,auth_time,created_at,last_active_at,absolute_expires_at) VALUES(?,?,'member',?,?,?,?,?,?)",hash,m.id,m.epoch,f.credential_id,f.proof_at||now,now,now,absolute),audit(db,m.id,'member_session_created',m.id,{credentialId:f.credential_id}));
 }
 statements.push(sql(db,'UPDATE identity_handoffs SET consumed_at=? WHERE code_hash=?',now,digest(code)),sql(db,"UPDATE identity_flows SET status='completed',verifier=NULL,proof=NULL WHERE id=?",f.id));
 await atomic(db,statements);return{token,next,keepDestination:f.purpose==='fresh'&&!!f.action?.startsWith('add:')};
}

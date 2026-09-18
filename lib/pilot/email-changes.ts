import {randomBytes} from 'node:crypto';
import {digest,same,passwordMatches} from '../auth/password';
import {type DB,type Row,fail,str,int,first,rows,stmt,guard,audit,ownerAccount} from './core';
import {operation,noteText} from './operation';
export const EMAIL_ADMIN_ACTIONS=['emailAdminRequest','emailCode','emailApprove','emailReject','emailComplete'];
const terminal=['completed','rejected','cancelled'];
const publicFields='id,member_id,old_email,new_email,status,code_expires_at,verified_at,approved_at,completed_at,note,version,created_at,updated_at';
export async function emailChanges(db:DB,m:Row,admin=false,q:Row={}){
 const offset=int(Number(q.offset||0),0,100000);
 const records=await rows(db,`SELECT ${publicFields} FROM email_change_requests ${admin?'':'WHERE member_id=?'} ORDER BY CASE WHEN status IN('awaiting_verification','ready_for_review','access_sync_pending') THEN 0 ELSE 1 END,created_at DESC,id DESC LIMIT 51 OFFSET ?`,...(admin?[]:[m.id]),offset);
 return {records:records.slice(0,50),nextOffset:records.length>50?offset+50:null};
}
function canManage(actor:Row,target:Row){
 if(ownerAccount(target))fail('The owner email is also a deployment security setting. Keep it unchanged here; coordinate the owner setting and Access policy together.',409);
 if(target.role==='admin'&&!ownerAccount(actor))fail('Only the owner can approve an administrator email change.',403);
}
export async function changeEmail(db:DB,m:Row,b:Row,tokenHash?:string){
 const action=str(b.action,40),admin=EMAIL_ADMIN_ACTIONS.includes(action),op=await operation(db,m,b,admin,tokenHash),now=Date.now();
 if(op.replayed){if(action==='emailVerify'&&!await first(db,'SELECT id FROM email_change_requests WHERE id=? AND member_id=? AND verified_at IS NOT NULL',str(b.id,80),m.id))fail('The code was not recognized. Refresh and try again.',400);return {ok:true,replayed:true};}
 if(action==='emailRequest'||action==='emailAdminRequest'){
  const target=action==='emailAdminRequest'?await first(db,'SELECT * FROM members WHERE id=? AND active=1',str(b.memberId,80)):m;
  if(!target)fail('Member unavailable.',404);
  if(ownerAccount(target))canManage(m,target);
  if(admin)canManage(m,target);
  const email=str(b.email,200).toLowerCase(),confirm=str(b.confirmEmail,200).toLowerCase();
  if(email!==confirm||!/^([^\s@]{1,64})@([^\s@]+\.[^\s@]+)$/.test(email)||email===target.email.toLowerCase())fail('Enter and confirm a different email address.');
  let credential:Row|null=null;
  if(!admin){credential=await first(db,'SELECT password_hash FROM auth_credentials WHERE member_id=?',m.id);if(!credential||!await passwordMatches(str(b.password,128),credential.password_hash))fail('Your current password was not recognized.',403)}
  if(await first(db,'SELECT id FROM members WHERE lower(email)=?',email))fail('This address cannot be used. Contact the store team.',409);
  await op.commit([
   guard(db,"EXISTS(SELECT 1 FROM members WHERE id=? AND email=? AND role=? AND active=1)",target.id,target.email,target.role),
   ...(!admin?[guard(db,'EXISTS(SELECT 1 FROM auth_credentials WHERE member_id=? AND password_hash=?)',m.id,credential!.password_hash)]:[]),
   guard(db,'NOT EXISTS(SELECT 1 FROM members WHERE lower(email)=?)',email),
   guard(db,'(SELECT COUNT(*) FROM email_change_requests WHERE member_id=? AND created_at>?)<3',target.id,now-86400000),
   stmt(db,"INSERT INTO email_change_requests(id,member_id,old_email,new_email,status,created_at,updated_at) VALUES(?,?,?,?,'awaiting_verification',?,?)",op.id,target.id,target.email,email,now,now),
   audit(db,m.id,'email_change_requested',op.id,{memberId:target.id,adminInitiated:admin})
  ]);return {ok:true,id:op.id};
 }
 const r=await first(db,'SELECT * FROM email_change_requests WHERE id=?',str(b.id,80));
 if(!r||(!admin&&r.member_id!==m.id))fail('Request unavailable.',404);
 if(terminal.includes(r.status))fail('This email request is already closed.',409);
 const target=await first(db,'SELECT * FROM members WHERE id=? AND active=1',r.member_id);
 if(!target)fail('Member access must be active.',409);
 if(admin)canManage(m,target);
 const g=guard(db,'EXISTS(SELECT 1 FROM email_change_requests WHERE id=? AND version=? AND status=?) AND EXISTS(SELECT 1 FROM members WHERE id=? AND email=? AND role=? AND active=1)',r.id,int(b.version),r.status,target.id,r.old_email,target.role);
 if(action==='emailCode'){
  if(r.status!=='awaiting_verification')fail('This address was already verified.',409);
  const code=randomBytes(16).toString('hex'),expires=now+86400000;
  await op.commit([g,stmt(db,'UPDATE email_change_requests SET code_hash=?,code_expires_at=?,attempts=0,version=version+1,updated_at=? WHERE id=?',digest(code),expires,now,r.id),audit(db,m.id,'email_verification_issued',r.id,{expiresAt:expires})]);
  return {ok:true,code,email:r.new_email,expiresAt:expires};
 }
 if(action==='emailVerify'){
  if(r.status!=='awaiting_verification'||!r.code_hash||r.code_expires_at<=now||r.attempts>=5)fail('Ask an administrator for a fresh verification code.',409);
  const code=str(b.code,80).replace(/\s/g,'').toLowerCase();
  if(!same(digest(code),r.code_hash)){
   // Persist failed attempts atomically; they must not roll back with the response.
   await op.commit([g,stmt(db,'UPDATE email_change_requests SET attempts=attempts+1,version=version+1,updated_at=? WHERE id=?',now,r.id)]);
   fail('The code was not recognized. Refresh and try again.',400);
  }
  await op.commit([g,guard(db,'EXISTS(SELECT 1 FROM email_change_requests WHERE id=? AND attempts<5 AND code_expires_at>?)',r.id,now),stmt(db,"UPDATE email_change_requests SET status='ready_for_review',verified_at=?,code_hash=NULL,code_expires_at=NULL,version=version+1,updated_at=? WHERE id=?",now,now,r.id),audit(db,m.id,'email_address_verified',r.id,{})]);
  return {ok:true};
 }
 if(action==='emailCancel'){
  if(r.status==='access_sync_pending')fail('Contact the store team to cancel while the Access policy is being updated.',409);
  await op.commit([g,stmt(db,"UPDATE email_change_requests SET status='cancelled',code_hash=NULL,code_expires_at=NULL,version=version+1,updated_at=? WHERE id=?",now,r.id),audit(db,m.id,'email_change_cancelled',r.id,{})]);return {ok:true};
 }
 if(action==='emailApprove'){
  if(r.status!=='ready_for_review'||!r.verified_at)fail('Verify the new email address first.',409);
  const note=noteText(b.note);
  await op.commit([g,stmt(db,"UPDATE email_change_requests SET status='access_sync_pending',approved_by=?,approved_at=?,note=?,version=version+1,updated_at=? WHERE id=?",m.id,now,note,now,r.id),audit(db,m.id,'email_change_approved',r.id,{note})]);return {ok:true};
 }
 if(action==='emailReject'){
  const note=noteText(b.note);
  if(r.status==='access_sync_pending'&&b.policyRestored!==true)fail('Confirm the previous Access policy remains in place before rejecting this request.');
  await op.commit([g,stmt(db,"UPDATE email_change_requests SET status='rejected',note=?,code_hash=NULL,code_expires_at=NULL,version=version+1,updated_at=? WHERE id=?",note,now,r.id),audit(db,m.id,'email_change_rejected',r.id,{note,policyRestored:!!b.policyRestored})]);return {ok:true};
 }
 if(action==='emailComplete'){
  if(r.status!=='access_sync_pending'||!r.verified_at)fail('Approve the verified request first.',409);
  if(b.newAddressAllowed!==true||b.oldAddressRemoved!==true||b.identityChecked!==true)fail('Complete all three Access-policy checks.');
  const note=noteText(b.note);
  await op.commit([g,
   guard(db,'EXISTS(SELECT 1 FROM members WHERE id=? AND email=? AND role=? AND active=1)',target.id,r.old_email,target.role),
   guard(db,'NOT EXISTS(SELECT 1 FROM members WHERE lower(email)=? AND id<>?)',r.new_email,target.id),
   stmt(db,'UPDATE members SET email=? WHERE id=?',r.new_email,target.id),
   stmt(db,'DELETE FROM auth_admin_access WHERE token_hash IN(SELECT token_hash FROM auth_sessions WHERE member_id=?)',target.id),
   stmt(db,'DELETE FROM auth_sessions WHERE member_id=?',target.id),stmt(db,'DELETE FROM auth_setup WHERE member_id=?',target.id),stmt(db,'DELETE FROM auth_recovery WHERE member_id=?',target.id),
   stmt(db,'INSERT INTO member_email_history(id,member_id,old_email,new_email,actor,note,created_at) VALUES(?,?,?,?,?,?,?)',r.id,target.id,r.old_email,r.new_email,m.id,note,now),
   stmt(db,"UPDATE email_change_requests SET status='completed',completed_at=?,note=?,version=version+1,updated_at=? WHERE id=?",now,note,now,r.id),
   audit(db,m.id,'member_email_changed',target.id,{requestId:r.id,oldEmail:r.old_email,newEmail:r.new_email,note,accessPolicyChecked:true})
  ]);return {ok:true};
 }
 fail('Choose a supported email action.');
}

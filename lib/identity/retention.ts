import {sql,type IdentitySettings} from './common';
const days=(value:string|undefined,fallback:number)=>{const n=Number(value);return Number.isInteger(n)&&n>=1&&n<=3650?n:fallback;};
export async function cleanIdentityMetadata(db:D1Database,env:IdentitySettings){
 const now=Date.now(),day=86400000;
 // Only new identity metadata. Never delete legacy business/history records.
 await db.batch([
  sql(db,"UPDATE identity_grants SET status='expired',version=version+1 WHERE id IN (SELECT id FROM identity_grants WHERE status='pending' AND expires_at<? LIMIT 500)",now),
  sql(db,'UPDATE identity_grants SET token_hash=NULL WHERE id IN (SELECT id FROM identity_grants WHERE expires_at<? AND token_hash IS NOT NULL LIMIT 500)',now-day),
  sql(db,'DELETE FROM identity_ceremonies WHERE id_hash IN (SELECT id_hash FROM identity_ceremonies WHERE expires_at<? LIMIT 500)',now-day),
  sql(db,"UPDATE identity_flows SET verifier=NULL,proof=NULL,action_payload=NULL,status=CASE WHEN status='completed' THEN status ELSE 'revoked' END WHERE id IN (SELECT id FROM identity_flows WHERE expires_at<? AND (verifier IS NOT NULL OR proof IS NOT NULL OR action_payload IS NOT NULL) LIMIT 500)",now-day),
  sql(db,'DELETE FROM identity_handoffs WHERE code_hash IN (SELECT code_hash FROM identity_handoffs WHERE expires_at<? LIMIT 500)',now-day),
  sql(db,"UPDATE identity_requests SET observed_email=NULL,tenant_id=NULL,object_id=NULL,reason=NULL,state=CASE WHEN state='pending' THEN 'expired' ELSE state END WHERE id IN (SELECT id FROM identity_requests WHERE last_seen_at<? AND (observed_email IS NOT NULL OR state='pending') LIMIT 500)",now-days(env.IDENTITY_REQUEST_RETENTION_DAYS,30)*day),
  sql(db,'DELETE FROM identity_sessions WHERE token_hash IN (SELECT token_hash FROM identity_sessions WHERE ended_at<? LIMIT 500)',now-days(env.IDENTITY_SESSION_RETENTION_DAYS,90)*day),
  sql(db,'DELETE FROM identity_audit WHERE id IN (SELECT id FROM identity_audit WHERE incident_hold=0 AND created_at<? LIMIT 500)',now-days(env.IDENTITY_AUDIT_RETENTION_DAYS,365)*day),
  sql(db,"UPDATE identity_imports SET rows_json='[]' WHERE id IN (SELECT id FROM identity_imports WHERE expires_at<? AND rows_json<>'[]' LIMIT 500)",now-day),
 ]);
}

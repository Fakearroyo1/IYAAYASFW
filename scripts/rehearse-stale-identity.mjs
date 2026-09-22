// Offline rehearsal only: refuse every database backed by a file. No network,
// output database, restore target, or production cutover exists in this module.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {databaseManifest,compareManifests,sha256,withManifestClock} from './backup-manifest.mjs';

export function rehearseStaleIdentity(db){
 assert.ok(db.prepare('PRAGMA database_list').all().every(d=>!d.file),'Rehearsal requires an in-memory database.');
 const evaluationTime=Date.now(),before=databaseManifest(db,{now:evaluationTime});
 // Containment intentionally turns off derived tab reminders. Compare every
 // other reminder field, rather than mistaking that access consequence for
 // changed business history (or ignoring entire views).
 const taskViews=['operational_tasks','operational_tasks_0'].filter(name=>before.objects[name]);
 const tasks=()=>withManifestClock(db,evaluationTime,()=>Object.fromEntries(taskViews.map(name=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY task_key').all().map(row=>row.type==='tab'?{...row,active:0}:row)])));
 const expectedTasks=tasks();
 const accountingVersion=db.prepare("SELECT version FROM accounting_revision WHERE id='main'").get().version;
 const memberState=()=>sha256(JSON.stringify(db.prepare('SELECT * FROM members ORDER BY id').all().map(({active,...row})=>row)));
 const preservedMembers=memberState();
 const target=db.prepare('SELECT id FROM members ORDER BY id LIMIT 1').get();
 assert.ok(target,'A representative existing member is required.');
 const member=target.id,now=Date.now(),prefix='restore-rehearsal-'+randomUUID();
 // Model an older snapshot where authority was still valid. All canaries exist
 // only in this private memory copy, never in the application or backup file.
 const credential=prefix+'-credential',grant=prefix+'-grant',flow=prefix+'-flow',token=prefix+'-session';
 db.prepare("INSERT INTO identity_credentials(id,member_id,kind,issuer,subject,client_id,label,provenance,created_at) VALUES(?,?,'google','https://restore.invalid',?,'synthetic-client','Rehearsal','isolated-recovery',?)").run(credential,member,prefix,now);
 db.prepare("INSERT INTO identity_credentials(id,member_id,kind,credential_id,public_key,rp_id,user_handle,label,provenance,created_at) VALUES(?,?,'passkey',?,'synthetic-public-key','restore.invalid','synthetic-handle','Rehearsal','isolated-recovery',?)").run(prefix+'-passkey',member,prefix+'-passkey-id',now);
 db.prepare("INSERT INTO identity_admin_principals(id,issuer,subject,member_id,provisioned_at,evidence) VALUES(?,'https://restore.invalid',?,?,?,'isolated-recovery')").run(prefix+'-principal',prefix,member,now);
 db.prepare("INSERT OR REPLACE INTO auth_setup VALUES(?,?,?,'isolated-recovery',?)").run(member,prefix+'-setup',now+600000,now);
 db.prepare("INSERT OR REPLACE INTO auth_recovery VALUES(?,?,?,'isolated-recovery',?)").run(member,prefix+'-recovery',now+600000,now);
 db.prepare("INSERT INTO identity_grants(id,member_id,kind,purpose,epoch,created_by,created_at,expires_at) VALUES(?,?,'invite','enroll',0,'rehearsal',?,?)").run(grant,member,now,now+600000);
 db.prepare("INSERT INTO identity_flows(id,purpose,member_id,grant_id,credential_id,status,proof,verifier,created_at,expires_at) VALUES(?,'login',?,?,?,'proven','synthetic-proof','synthetic-verifier',?,?)").run(flow,member,grant,credential,now,now+600000);
 db.prepare("INSERT INTO identity_ceremonies(id_hash,flow_id,kind,browser_hash,secret,created_at,expires_at) VALUES(?,?,'google','synthetic-browser','synthetic-secret',?,?)").run(prefix,flow,now,now+600000);
 db.prepare("INSERT INTO identity_handoffs(code_hash,flow_id,member_id,credential_id,epoch,purpose,callback,created_at,expires_at) VALUES(?,?,?,?,0,'login','https://restore.invalid',?,?)").run(prefix,flow,member,credential,now,now+60000);
 db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(token,member,now,now+600000);
 db.prepare("INSERT INTO identity_sessions(token_hash,member_id,audience,epoch,credential_id,auth_time,created_at,last_active_at,absolute_expires_at) VALUES(?,?,'member',0,?,?,?,?,?)").run(token,member,credential,now,now,now,now+600000);

 // Unknown latest revocation evidence: close every restored access path. The
 // owner must verify access through the independent control plane before any
 // real cutover. Keeping password hashes does not enable inactive members.
 db.exec('BEGIN');
 try{
  db.exec('UPDATE members SET active=0; UPDATE identity_state SET epoch=epoch+1,version=version+1; DELETE FROM auth_sessions; DELETE FROM auth_setup; DELETE FROM auth_recovery; DELETE FROM auth_admin_access;');
  db.prepare("UPDATE identity_credentials SET status='revoked',revoked_at=COALESCE(revoked_at,?) WHERE status='active'").run(now);
  db.exec("UPDATE identity_admin_principals SET status='revoked'; UPDATE identity_grants SET status='revoked',version=version+1 WHERE status='pending'; UPDATE identity_flows SET status='revoked',proof=NULL,verifier=NULL WHERE status IN ('pending','proven'); UPDATE identity_requests SET state='blocked' WHERE state='pending'; UPDATE identity_imports SET expires_at=0;");
  db.prepare('UPDATE identity_ceremonies SET secret=NULL,used_at=COALESCE(used_at,?)').run(now);
  db.prepare('UPDATE identity_handoffs SET consumed_at=COALESCE(consumed_at,?)').run(now);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 const count=query=>db.prepare(query).get().n;
 for(const query of [
  'SELECT count(*) n FROM members WHERE active=1',
  'SELECT count(*) n FROM auth_sessions',
  'SELECT count(*) n FROM auth_setup',
  'SELECT count(*) n FROM auth_recovery',
  'SELECT count(*) n FROM auth_admin_access',
  "SELECT count(*) n FROM identity_credentials WHERE status='active'",
  "SELECT count(*) n FROM identity_admin_principals WHERE status='active'",
  "SELECT count(*) n FROM identity_grants WHERE status='pending'",
  "SELECT count(*) n FROM identity_flows WHERE status IN ('pending','proven')",
  'SELECT count(*) n FROM identity_ceremonies WHERE secret IS NOT NULL OR used_at IS NULL',
  'SELECT count(*) n FROM identity_handoffs WHERE consumed_at IS NULL',
  "SELECT count(*) n FROM identity_sessions WHERE ended_at IS NULL",
 ])assert.equal(count(query),0,'Restored access remains closed.');
 assert.equal(db.prepare('SELECT status FROM identity_credentials WHERE id=?').get(credential).status,'revoked');
 assert.equal(db.prepare('SELECT status FROM identity_grants WHERE id=?').get(grant).status,'revoked');
 assert.equal(memberState(),preservedMembers,'Member IDs, roles, password-independent profile and balances must remain intact.');
 // The existing accounting cache revision increments for every members UPDATE,
 // including access-only changes. Verify its exact increment independently.
 assert.equal(db.prepare("SELECT version FROM accounting_revision WHERE id='main'").get().version,accountingVersion+before.objects.members.rows);
 const allowed=new Set(['members','accounting_revision','auth_sessions','auth_setup','auth_recovery','auth_admin_access']);
 assert.deepEqual(tasks(),expectedTasks,'Containment may only turn off tab reminder activity; every other task field is preserved.');
 for(const view of taskViews){assert.equal(db.prepare('SELECT COUNT(*) n FROM "'+view+'" WHERE type=? AND active<>0').get('tab').n,0);allowed.add(view);}
 const changed=compareManifests(before,databaseManifest(db,{now:evaluationTime}),{schema:false}).filter(name=>!name.startsWith('identity_')&&!allowed.has(name));
 assert.deepEqual(changed,[],'Business history, stock, rewards, privacy, passwords and member access selections must remain intact.');
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 return {result:'passed',scope:'in-memory restored snapshot with synthetic stale credential/grant/session/ceremony/handoff canaries',access:'all restored members inactive; methods/principals revoked; sessions and pending authority invalidated',preservation:'business rows and member fields except active match; accounting cache revision advances by the exact member count',cutover:'denied until owner re-verifies access; no production operation'};
}

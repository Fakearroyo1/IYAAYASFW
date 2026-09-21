// Synthetic records only. Exercise real import transactions, identity enrollment,
// concurrency guards and preservation of all existing member/business records.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from './identity-fixture.mjs';
const f=await fixture(),{db,sqlite,hooks}=f;
const C=await f.module('lib/identity/common'),S=await f.module('lib/identity/sessions'),F=await f.module('lib/identity/flows'),M=await f.module('lib/identity/manage'),I=await f.module('lib/identity/imports'),R=await f.module('lib/identity/roster-format'),P=await f.module('lib/identity/providers');
const {passwordHash}=await f.module('lib/auth/password');
const now=Date.now(),password='Synthetic owner password 123456';
const env={IDENTITY_ENABLED:'true',IDENTITY_ROLLOUT:'all-approved',IDENTITY_BASE_DOMAIN:'identity.test',IDENTITY_OWNER_MEMBER_ID:'owner',IDENTITY_GOOGLE_ENABLED:'true',IDENTITY_GOOGLE_BOOTSTRAP_ENABLED:'true',IDENTITY_MICROSOFT_ENABLED:'true',GOOGLE_CLIENT_ID:'fixture-google',GOOGLE_CLIENT_SECRET:'synthetic',MICROSOFT_CLIENT_ID:'fixture-ms',MICROSOFT_CLIENT_SECRET:'synthetic'};
sqlite.exec("INSERT INTO members(id,email,name,role,debt,credit) VALUES('owner','owner@example.test','Owner','admin',0,0),('old','old@example.test','Existing Member','member',825,400),('disabled','disabled@example.test','Disabled','member',150,200)");
sqlite.exec("UPDATE members SET active=0 WHERE id='disabled'");
sqlite.prepare('INSERT INTO auth_credentials VALUES(?,?,?)').run('owner',await passwordHash(password),now);
sqlite.exec(readFileSync('IDENTITY-SCHEMA.sql','utf8'));
const principal={id:'principal',member_id:'owner',identity_owner:1,issuer:'https://fixture.cloudflareaccess.com',subject:'owner-subject',expiresAt:now+1800000};
sqlite.prepare('INSERT INTO identity_admin_principals(id,issuer,subject,member_id,identity_owner,provisioned_at,evidence) VALUES(?,?,?,?,1,?,?)').run(principal.id,principal.issuer,principal.subject,'owner',now,'synthetic');
const token=await S.adminSession(db,principal),owner=await S.readSession(db,new Request('https://admin.identity.test',{headers:{Cookie:C.ADMIN_COOKIE+'='+token}}),'admin');
let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;};const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};const rejects=async fn=>{await assert.rejects(fn);checks++;};
async function authorize(payload){
 sqlite.prepare('DELETE FROM auth_limits WHERE id=?').run(C.digest('identity-password:owner'));
 const dest=C.digest(C.random()),fid=await F.newFlow(db,dest,'/identity',owner,'owner:'+M.payloadHash(payload),payload);
 await F.freshPassword(db,await C.flow(db,fid),password);
 const parts=new URLSearchParams(new URL(await F.issueHandoff(db,env,fid)).hash.slice(1));
 const result=await F.redeem(db,env,fid,parts.get('code'),dest,'admin',owner);
 return new URL(result.next,'https://admin.identity.test').searchParams.get('approval');
}
const payloadFor=p=>({operation:'importCommit',batch:p.batch,hash:p.hash,rows:p.rows.filter(r=>['Create','Update'].includes(r.status)).map(r=>r.number)});
const preview=csv=>I.previewImport(db,env,owner,csv,'create');
async function apply(p){const payload=payloadFor(p),grant=await authorize(payload);return I.commitImport(db,env,owner,payload,grant);}
const csv=rows=>R.csvFile([R.NEW_MEMBER_HEADERS,...rows]);
const row=(name,email,google='',enabled='TRUE')=>[name,email,'',google,enabled];
// Seed existing business history so preservation checks cannot pass on empty tables alone.
sqlite.exec("INSERT INTO orders(id,code,fingerprint,member_id,payer,method,total,tax,status,created_at) VALUES('old-order','OLD','old-fingerprint','old','Existing','tab',825,0,'completed',1)");
const originalMembers=JSON.stringify(sqlite.prepare("SELECT * FROM members WHERE id IN ('owner','old','disabled') ORDER BY id").all());
const existingIdentity=JSON.stringify(sqlite.prepare("SELECT * FROM identity_state WHERE member_id IN ('owner','old','disabled') ORDER BY member_id").all());
const businessTables=sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'identity_%' AND name NOT LIKE 'auth_%' AND name NOT IN ('members','member_access','member_controls','guards') ORDER BY name").all().map(r=>r.name);
const businessSnapshot=name=>JSON.stringify(sqlite.prepare('SELECT * FROM "'+name+'"'+(sqlite.prepare('PRAGMA table_info("'+name+'")').all().some(c=>c.name==='member_id')?" WHERE member_id IN ('owner','old','disabled')":'')).all());
const businessBefore=businessTables.map(name=>[name,businessSnapshot(name)]);
const count=()=>sqlite.prepare('SELECT count(*) n FROM members').get().n;
const initial=count();
const first=await preview(csv([row('García, "Jr"','New@Example.test','New@gmail.com'),row('Invitation Member','invite@example.test'),row('Disabled new','off@example.test','','FALSE')]));
check(first.rows.every(r=>r.status==='Create'),'quoted UTF8 and uppercase Excel booleans work');
equal(count(),initial,'preview does not create members');
await rejects(()=>I.previewImport(db,env,null,csv([row('N','n@example.test')]),'create'));
await rejects(()=>I.commitImport(db,env,owner,payloadFor(first),'missing-proof'));
const payload=payloadFor(first),grant=await authorize(payload);
await rejects(()=>I.commitImport(db,env,owner,{...payload,rows:[1]},grant));
const created=await I.commitImport(db,env,owner,payload,grant);
equal(created.applied,3,'creates three members');
const n=sqlite.prepare("SELECT * FROM members WHERE email='new@example.test'").get();
check(n&&n.role==='member'&&n.debt===0&&n.credit===0&&n.tab_limit===3000&&n.active===1,'ordinary member has established defaults');
check(sqlite.prepare('SELECT * FROM member_access WHERE member_id=?').get(n.id).gear===1,'shop access initialized');
check(sqlite.prepare('SELECT * FROM member_controls WHERE member_id=?').get(n.id).posting_enabled===1,'controls initialized');
check(sqlite.prepare('SELECT user_handle FROM identity_state WHERE member_id=?').get(n.id).user_handle.length===64,'new passkey handle exists');
check(!sqlite.prepare('SELECT 1 FROM auth_credentials WHERE member_id=?').get(n.id),'no generated password');
check(!sqlite.prepare("SELECT 1 FROM identity_grants WHERE kind='invite'").get(),'no unsolicited invitations issued');
check(sqlite.prepare("SELECT 1 FROM identity_grants WHERE kind='bootstrap' AND provider='google' AND member_id=? AND match_email='New@gmail.com'").get(n.id),'explicit Google address preauthorized');
equal((await I.commitImport(db,env,owner,payload,grant)).alreadyApplied,3,'same approval retry returns committed results');
equal(count(),initial+3,'retry creates no duplicate');
equal((await I.readImport(db,env,owner,first.batch,first.hash)).applied.length,3,'interrupted client can recover result status');
const again=await preview(csv([row('Different name','NEW@example.test','New@gmail.com'),row('Disabled','disabled@example.test')]));
check(again.rows.every(r=>r.status==='Exists'),'reupload and disabled existing emails are skipped');
const dup=await preview(csv([row('Duplicate','dup@example.test'),row('Duplicate','DUP@example.test')]));
check(dup.rows.every(r=>r.status==='Conflict'),'both duplicate rows blocked');
const gd=await preview(csv([row('A','a@example.test','Same@gmail.com'),row('B','b@example.test','same@gmail.com')]));
check(gd.rows.every(r=>r.status==='Conflict'),'case-variant Google grants collide conservatively');
const bad=await preview(csv([row('Missing',''),row('=HYPERLINK("bad")','bad@example.test'),row('Off grant','offgrant@example.test','offgrant@gmail.com','FALSE'),row('Access','access@example.test','','yes')]).replace("'=HYPERLINK","=HYPERLINK"));
check(bad.rows.every(r=>r.status==='Conflict'),'required fields, formula cells, disabled grants and invalid booleans rejected');
for(const input of ['display_name,email,access_enabled,role\nN,n@example.test,TRUE,admin','display_name,email,access_enabled,member_id\nN,n@example.test,TRUE,old','display_name,email,email,access_enabled\nN,a@b.test,a@b.test,TRUE']){assert.throws(()=>I.parseRoster(input,'create'));checks++;}
assert.throws(()=>I.parseRoster('display_name,email,access_enabled\n"unterminated,n@example.test,TRUE','create'));checks++;
assert.throws(()=>I.parseRoster('display_name,email,access_enabled\nBad"quote,n@example.test,TRUE','create'));checks++;
assert.throws(()=>I.parseRoster(csv(Array.from({length:101},(_,i)=>row('M'+i,'m'+i+'@example.test'))),'create'));checks++;
assert.throws(()=>I.parseRoster('é'.repeat(32769),'create'));checks++;
equal(R.csvCell('=1+1'),'"\'=1+1"','reports cannot execute a leading formula');
check(I.parseRoster('display_name,email,access_enabled\r\n"Two\nLines",line@example.test,TRUE\r\n\r\n','create')[0].display_name==='Two\nLines','quoted newlines and trailing blank lines supported');
const names=await preview(csv([row('Existing Member','different@example.test')]));
check(names.rows[0].warnings.length>0&&names.rows[0].status==='Create','same name warns without merging');
// Race: another member appears after preview; transaction must refuse to overwrite it.
const stale=await preview(csv([row('Stale','race@example.test')]));
sqlite.prepare("INSERT INTO members(id,email,name,role,debt,credit) VALUES('race','race@example.test','Other admin created','member',199,299)").run();
equal((await apply(stale)).conflicts,1,'race fails closed');
check(!sqlite.prepare('SELECT 1 FROM members WHERE id=?').get(stale.rows[0].memberId),'failed create leaves no member');
check(sqlite.prepare("SELECT debt FROM members WHERE id='race'").get().debt===199,'racing member financial data preserved');
// Conflict in a dependent grant insert must roll back the member and access records.
const reservation=await preview(csv([row('Reservation','reserved@example.test','reserved@gmail.com')]));
sqlite.prepare("INSERT INTO identity_grants(id,member_id,kind,purpose,provider,match_email,raw_email,epoch,created_by,created_at,expires_at) VALUES('reserved','old','bootstrap','first-association','google','reserved@gmail.com','reserved@gmail.com',0,'owner',?,?)").run(now,now+86400000);
equal((await apply(reservation)).conflicts,1,'late provider conflict rejected');
for(const table of ['members','member_access','member_controls','identity_state'])check(!sqlite.prepare('SELECT 1 FROM '+table+' WHERE '+(table==='members'?'id':'member_id')+'=?').get(reservation.rows[0].memberId),'atomic rollback '+table);
// Per-row transaction: one injected storage failure doesn't create a partial account.
const partial=await preview(csv([row('Good','good@example.test'),row('Fail','fail@example.test')]));
const pp=payloadFor(partial),pg=await authorize(pp);
hooks.beforeBatch=function failSelectedRow(statements){if(statements.some(s=>s.sql.startsWith('INSERT INTO members')&&s.values.includes('fail@example.test')))throw Error('synthetic storage failure');hooks.beforeBatch=failSelectedRow;};
const pr=await I.commitImport(db,env,owner,pp,pg);
equal([pr.applied,pr.conflicts],[1,1],'accurate partial result');
check(!sqlite.prepare("SELECT 1 FROM members WHERE email='fail@example.test'").get(),'failed row absent');
equal((await I.commitImport(db,env,owner,pp,pg)).alreadyApplied,1,'retry skips first committed row');
check(sqlite.prepare("SELECT 1 FROM members WHERE email='fail@example.test'").get(),'retry completes failed row');
const expired=await preview(csv([row('Expired','expired@example.test')]));sqlite.prepare('UPDATE identity_imports SET expires_at=0 WHERE id=?').run(expired.batch);await rejects(()=>apply(expired));
// Full real protocol uses the created Google preauthorization, while invitation-only accounts need proof.
const login=await F.newFlow(db,C.digest('new-login'),'/');
const credential=await F.associateProvider(db,env,{kind:'google',issuer:P.ISSUERS.google,subject:'new-google-subject',clientId:env.GOOGLE_CLIENT_ID,email:'New@gmail.com',bootstrapEmail:'New@gmail.com',tenant:null,objectId:null,authTime:Date.now()},await C.flow(db,login));
equal(credential.member_id,n.id,'Google first login binds the new immutable member');
const inviteMember=sqlite.prepare("SELECT id FROM members WHERE email='invite@example.test'").get();
const ip={operation:'invite',target:inviteMember.id,purpose:'enroll',identityVerified:true};
const invitation=await M.adminMutation(db,env,owner,ip,await authorize(ip)),code=new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('invite');
check(invitation.memberId===inviteMember.id&&invitation.memberName==='Invitation Member','invitation labels exact recipient');
check(!JSON.stringify(sqlite.prepare("SELECT * FROM identity_grants WHERE kind='invite'").all()).includes(code),'raw code is never stored');
const flow=await F.claimInvite(db,code,C.digest('invite-register'));
await F.bridgeInvite(db,flow,C.digest('invite-destination'),null);
await F.storeEnrollmentProof(db,await C.flow(db,flow),{kind:'microsoft',issuer:P.ISSUERS.microsoft,subject:'personal-microsoft',clientId:env.MICROSOFT_CLIENT_ID,email:'different@outlook.com',bootstrapEmail:null,tenant:P.CONSUMER_TENANT,objectId:null,authTime:Date.now()});
await F.finishEnrollment(db,await C.flow(db,flow),'Personal Microsoft');
await rejects(()=>F.claimInvite(db,code,C.digest('replay')));
check(sqlite.prepare("SELECT member_id FROM identity_credentials WHERE subject='personal-microsoft'").get().member_id===inviteMember.id,'invitation enrollment permits different Microsoft address without matching');
// 60-row batch uses actual commit path, not preview-only coverage.
const bulk=await preview(csv(Array.from({length:60},(_,i)=>row('Bulk '+i,'bulk'+i+'@example.test',i%2?'':'bulk'+i+'@gmail.com'))));
equal((await apply(bulk)).applied,60,'60 new members committed');
equal(JSON.stringify(sqlite.prepare("SELECT * FROM members WHERE id IN ('owner','old','disabled') ORDER BY id").all()),originalMembers,'existing member records untouched');
equal(JSON.stringify(sqlite.prepare("SELECT * FROM identity_state WHERE member_id IN ('owner','old','disabled') ORDER BY member_id").all()),existingIdentity,'existing member identity handles and epochs untouched');
for(const [table,before] of businessBefore)equal(businessSnapshot(table),before,'preserved '+table);
// Revoking the method used for fresh proof stops even a consumed approval mid-import.
const revokedPreview=await preview(csv([row('Revoked proof','revoked-proof@example.test')]));
const revokedPayload=payloadFor(revokedPreview),revokedGrant=await authorize(revokedPayload);
sqlite.prepare("INSERT INTO identity_credentials(id,member_id,kind,issuer,subject,client_id,label,provenance,created_at) VALUES('owner-proof','owner','google',?,'owner-proof',?,'Owner proof','synthetic',?)").run(P.ISSUERS.google,env.GOOGLE_CLIENT_ID,now);
sqlite.prepare('UPDATE identity_grants SET proof_credential=? WHERE id=?').run('owner-proof',revokedGrant);
hooks.beforeBatch=function revokeBeforeRow(statements){if(statements.some(s=>s.sql.startsWith('INSERT INTO members')))sqlite.prepare("UPDATE identity_credentials SET status='revoked' WHERE id='owner-proof'").run();else hooks.beforeBatch=revokeBeforeRow;};
equal((await I.commitImport(db,env,owner,revokedPayload,revokedGrant)).conflicts,1,'revocation between proof consumption and row commit denies mutation');
check(!sqlite.prepare("SELECT 1 FROM members WHERE email='revoked-proof@example.test'").get(),'revoked approval creates no account');
await rejects(()=>I.commitImport(db,env,owner,revokedPayload,revokedGrant));
console.log(`${checks} new-member import, retry, Google/invitation enrollment and record-preservation checks passed (synthetic SQLite).`);
sqlite.close();

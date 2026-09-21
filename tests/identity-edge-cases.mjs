import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from './identity-fixture.mjs';
const fixtureState=await fixture(),{db,sqlite}=fixtureState;
const C=await fixtureState.module('lib/identity/common'),F=await fixtureState.module('lib/identity/flows'),M=await fixtureState.module('lib/identity/manage'),S=await fixtureState.module('lib/identity/sessions');
const env={IDENTITY_ENABLED:'true',IDENTITY_ROLLOUT:'all-approved',IDENTITY_OWNER_MEMBER_ID:'owner',IDENTITY_BASE_DOMAIN:'identity.test',IDENTITY_PASSKEY_ENABLED:'true',IDENTITY_GOOGLE_ENABLED:'true',GOOGLE_CLIENT_ID:'current-client',GOOGLE_CLIENT_SECRET:'synthetic'};
sqlite.exec("INSERT INTO members(id,email,name,role) VALUES('owner','owner@example.test','Owner','admin'),('member','member@example.test','Member','member');");sqlite.exec(readFileSync('IDENTITY-SCHEMA.sql','utf8'));
let checks=0;const check=(x,label)=>{assert.ok(x,label);checks++;};const rejects=async(fn,label)=>{await assert.rejects(fn,label);checks++;};
const now=Date.now(),credentials=[];
for(let i=0;i<2;i++){const id=C.id();sqlite.prepare("INSERT INTO identity_credentials(id,member_id,kind,credential_id,public_key,counter,user_handle,rp_id,label,provenance,created_at) SELECT ?,'member','passkey',?,'synthetic-key',0,user_handle,'identity.test',?,'synthetic',? FROM identity_state WHERE member_id='member'").run(id,'synthetic-'+i,'Device '+i,now-10000);credentials.push(await C.one(db,'SELECT * FROM identity_credentials WHERE id=?',id));}
const user=(n=0)=>({memberId:'member',userId:'member:member',email:'member@example.test',displayName:'Member',role:'member',tokenHash:C.digest('session-'+n),audience:'member',epoch:0,principalId:null});
for(let n=0;n<2;n++)sqlite.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(user(n).tokenHash,'member',now,now+600000);
const approval=async(n,target)=>{
 const u=user(n),dest=C.digest('destination-'+C.random()),fid=await F.newFlow(db,dest,'/identity',u,'unlink:'+target);
 await F.authenticated(db,await C.flow(db,fid),credentials[n]);const parts=new URLSearchParams(new URL(await F.issueHandoff(db,env,fid)).hash.slice(1)),r=await F.redeem(db,env,fid,parts.get('code'),dest,'member',u);return new URL(r.next,'https://identity.test').searchParams.get('approval');
};
const pending=await F.newFlow(db,C.digest('login'),'/');await F.authenticated(db,await C.flow(db,pending),credentials[0]);
await rejects(()=>F.issueHandoff(db,{...env,IDENTITY_ROLLOUT:'owner-smoke'},pending),'owner smoke cannot issue member handoff');
await rejects(()=>F.issueHandoff(db,{...env,IDENTITY_PASSKEY_ENABLED:'false'},pending),'disabled method cannot issue handoff');
const handoff=new URLSearchParams(new URL(await F.issueHandoff(db,env,pending)).hash.slice(1));
await rejects(()=>F.redeem(db,{...env,IDENTITY_PASSKEY_ENABLED:'false'},pending,handoff.get('code'),C.digest('login'),'member',null),'method kill switch applies after proof');
await rejects(()=>F.redeem(db,{...env,IDENTITY_ROLLOUT:'owner-smoke'},pending,handoff.get('code'),C.digest('login'),'member',null),'audience rollback applies at final redemption');
const fresh=await F.newFlow(db,C.digest('fresh'),'/identity',user(),'add:google');
await rejects(async()=>F.authenticated(db,await C.flow(db,fresh),{...credentials[0],created_at:Date.now()+10000}),'fresh proof must predate requested addition');
const firstApproval=await approval(0,credentials[0].id);
sqlite.prepare('UPDATE identity_credentials SET rp_id=? WHERE id=?').run('old-rp.test',credentials[1].id);
await rejects(()=>M.ownMutation(db,env,user(),{operation:'unlink',target:credentials[0].id,approval:firstApproval}),'an unusable old RP credential does not count as a remaining method');
sqlite.prepare('UPDATE identity_credentials SET rp_id=? WHERE id=?').run('identity.test',credentials[1].id);
const secondApproval=await approval(1,credentials[1].id);
const race=await Promise.allSettled([M.ownMutation(db,env,user(0),{operation:'unlink',target:credentials[0].id,approval:firstApproval}),M.ownMutation(db,env,user(1),{operation:'unlink',target:credentials[1].id,approval:secondApproval})]);
check(race.filter(x=>x.status==='fulfilled').length===1,'two concurrent removals cannot remove the last method');
check(sqlite.prepare("SELECT count(*) n FROM identity_credentials WHERE member_id='member' AND status='active'").get().n===1,'one usable method remains');
// Temporary owner rehearsal keeps the established MFA route usable for current administrators.
const ownerToken=C.sessionToken();sqlite.prepare('INSERT INTO auth_credentials VALUES(?,?,?)').run('owner','synthetic-password-hash',now);sqlite.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(C.digest(ownerToken),'owner',now,now+600000);
const request=new Request('https://identity.test',{headers:{Cookie:'__Host-supply-session='+ownerToken}});
check((await S.applicationSession(db,{...env,IDENTITY_ROLLOUT:'owner-smoke'},request,'member')).role==='admin','owner rehearsal preserves current admin commerce role');
check((await S.applicationSession(db,env,request,'member')).role==='member','final cutover removes apex administrator authority');
console.log(`${checks} identity rollout, method-disable, existing-proof, and last-method race checks passed.`);sqlite.close();

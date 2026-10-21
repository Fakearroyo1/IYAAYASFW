import assert from 'node:assert/strict';
import { fixture } from './identity-fixture.mjs';
import {challengeBindings,challengeService} from './security-fixtures.mjs';
const f=await fixture();
Object.assign(f.env,challengeBindings);
globalThis.fetch=(input,init)=>challengeService(new Request(input,init));
const {passwordHash,digest}=await f.module('lib/auth/password');
const {POST}=await f.module('app/api/auth/route');
const {mutate}=await f.module('lib/pilot/service');
const token='a'.repeat(64), now=Date.now();
const actor={memberId:'owner',userId:'owner-user',email:'owner@example.test',tokenHash:digest(token)};
const hash=await passwordHash('containment test password 12345');
f.sqlite.prepare("INSERT INTO members(id,email,name,role,user_id) VALUES('owner','owner@example.test','Owner','admin','owner-user')").run();
f.sqlite.prepare('INSERT INTO auth_credentials VALUES(?,?,?)').run('owner',hash,now);
f.sqlite.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(actor.tokenHash,'owner',now,now+1800000);
f.sqlite.prepare('INSERT INTO auth_admin_access VALUES(?,?,?,?)').run(actor.tokenHash,'fixture-owner',now,now+1800000);
f.sqlite.prepare("INSERT INTO settings(id) VALUES('main')").run();
const call=(body)=>POST(new Request('https://test.local/api/auth',{method:'POST',headers:{Origin:'https://test.local','Content-Type':'application/json',Cookie:'__Host-supply-session='+token},body:JSON.stringify(body)}));
const change=(id,active,role='member',gear=true)=>mutate(f.db,actor,{action:'member',requestId:crypto.randomUUID(),id,email:id+'@example.test',name:id,active,role,snacks:true,gear,tabLimit:3000,debt:125,credit:75,previousDebt:125,previousCredit:75});
let count=0;
for(const recovery of [false,true]){
  const id=recovery?'recovery-race':'setup-race';
  f.sqlite.prepare('INSERT INTO members(id,email,name,role,debt,credit) VALUES(?,?,?,\'member\',125,75)').run(id,id+'@example.test',id);
  if(recovery)f.sqlite.prepare('INSERT INTO auth_credentials VALUES(?,?,?)').run(id,hash,now);
  const issue=()=>call({action:recovery?'issueRecovery':'issueSetup',memberId:id,identityVerified:true});
  let response=await issue();assert.equal(response.status,200);count++;
  await change(id,false);await change(id,true);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM '+(recovery?'auth_recovery':'auth_setup')+' WHERE member_id=?').get(id).n,0);count++;
  // Issuance reads eligibility, then containment commits before issuance's batch.
  f.hooks.beforeBatch=async()=>{await change(id,false);await change(id,true);};
  response=await issue();assert.equal(response.status,409,'stale issuance fails after disable/reactivation');count++;
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM '+(recovery?'auth_recovery':'auth_setup')+' WHERE member_id=?').get(id).n,0);count++;
  // Reverse ordering: issuance wins, subsequent containment destroys its code.
  response=await issue();assert.equal(response.status,200);await change(id,false);await change(id,true);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM '+(recovery?'auth_recovery':'auth_setup')+' WHERE member_id=?').get(id).n,0);count++;
  for (const accessChange of [()=>change(id,true,'admin'),()=>change(id,true,'member',false)]) {
    f.hooks.beforeBatch=accessChange;
    response=await issue();assert.equal(response.status,409,'stale issuance fails after role or shop access change');count++;
    await change(id,true);
  }
  response=await issue();assert.equal(response.status,200);
  let code=(await response.json()).code;
  const consume=()=>call({action:recovery?'completeRecovery':'completeSetup',email:id+'@example.test',code,password:'new unique containment passphrase 9999',challengeToken:'test-valid'});
  f.hooks.beforeBatch=async()=>{await change(id,false);await change(id,true);};
  response=await consume();assert.equal(response.status,409,'consumption loses to containment even after proof was read');count++;
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM auth_sessions WHERE member_id=?').get(id).n,0);count++;
  response=await issue();code=(await response.json()).code;
  response=await consume();assert.equal(response.status,200,'consumption can win before containment');count++;
  await change(id,false);await change(id,true);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM auth_sessions WHERE member_id=?').get(id).n,0);count++;
  const row=f.sqlite.prepare('SELECT debt,credit FROM members WHERE id=?').get(id);
  assert.deepEqual({...row},{debt:125,credit:75});count++;
}
f.sqlite.close();
console.log(`${count} deterministic setup/recovery containment and issuance race checks passed.`);

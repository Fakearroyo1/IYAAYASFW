// Real compiled Worker, isolated D1, and signed synthetic Access. No live data.
import assert from 'node:assert/strict';
import {workflowWorker} from './workflow-worker.mjs';
const f=await workflowWorker();
let checks=0;
const check=(v,label)=>{assert.ok(v,label);checks++};
async function read(path,who=f.admin){const r=await f.request(who,path),j=await r.json();check(r.status===200,path+': '+JSON.stringify(j));return j}
async function post(path,body){return readResponse(f.request(f.admin,path,{requestId:crypto.randomUUID(),...body}),body.action)}
async function readResponse(p,label){const r=await p,j=await r.json();check(r.status===200,label+': '+JSON.stringify(j));return j}
const oneRecord=(j,id,label)=>check(j.records.length===1&&j.records[0].id===id,label);
try{
  // Targets deliberately fall beyond the normal list limits.
  for(let n=0;n<115;n++){
    await f.run('INSERT INTO members(id,name,email,role) VALUES(?,?,?,\'member\')','target-member-'+n,'Target member '+n,'target'+n+'@example.test');
    await f.run('INSERT INTO item_requests(id,member_id,shop,title,body,created_at,updated_at) VALUES(?,\'member\',\'gear\',?,?,?,?)','request-'+n,'Requested item '+n,'Synthetic request body',1000+n,1000+n);
    await f.run('INSERT INTO community_reports(id,member_id,kind,target,reason,created_at) VALUES(?,\'other\',\'request\',?,?,?)','report-'+n,'request-'+n,'Synthetic moderation reason',1000+n);
    await f.run("INSERT INTO team_messages(id,actor,title,body,kind,created_at,updated_at) VALUES(?,'owner',?,?,'question',?,?)",'thread-'+n,'Question '+n,'Synthetic team question',1000+n,1000+n);
    if(n<55){
      await f.run("INSERT INTO email_change_requests(id,member_id,old_email,new_email,status,created_at,updated_at) VALUES(?,'member','member@example.test',?,'completed',?,?)",'email-'+n,'changed'+n+'@example.test',1000+n,1000+n);
      await f.run("INSERT INTO orders(id,code,fingerprint,member_id,payer,method,total,tax,status,created_at) VALUES(?,?,?,'other','Other member','cash',1500,0,'paid',?)",'order-'+n,'SYNTH-'+n,'fixture-'+n,1000+n);
      await f.run("INSERT INTO order_items(id,order_id,product_id,name,qty,price,tax_bp) VALUES(?,?,'gear','Synthetic shirt',1,1500,0)",'item-'+n,'order-'+n);
      await f.run("INSERT INTO order_item_details(item_id,fulfillment,updated_at) VALUES(?,'ready',?)",'item-'+n,1000+n);
    }
    if(n<6){
      await f.run("INSERT INTO products(id,name,category,price,stock,active) VALUES(?,?,'Gear',1500,5,1)",'trial-product-'+n,'Trial product '+n);
      await f.run("INSERT INTO product_initiatives(id,request_id,product_id,kind,state,ends_at,actor,created_at,updated_at) VALUES(?,?,?,'trial','open',1,'owner',?,?)",'trial-'+n,'request-'+n,'trial-product-'+n,1000+n,1000+n);
    }
  }
  const before=await f.one('SELECT (SELECT SUM(debt) FROM members) debt,(SELECT SUM(credit) FROM members) credit,(SELECT SUM(stock) FROM products) stock,(SELECT COUNT(*) FROM payments) payments,(SELECT COUNT(*) FROM money_movements) movements');
  check(!(await read('/api/community?kind=requests&shop=gear')).records.some(r=>r.id==='request-0'),'old request is outside first page');
  const request=await read('/api/community?kind=requests&shop=snacks&id=request-0');oneRecord(request,'request-0','request link finds exact record in actual shop');check(request.shop==='gear','request supplies correct shop context');
  check(!(await read('/api/operations?kind=initiatives&admin=true&shop=gear')).records.some(r=>r.id==='trial-0'),'old trial is outside first page');
  const trial=await read('/api/operations?kind=initiatives&admin=true&shop=snacks&id=trial-0');oneRecord(trial,'trial-0','trial link finds exact record across shop defaults');check(trial.shop==='gear','trial supplies correct shop context');
  check(!(await read('/api/operations?kind=emailAdmin')).records.some(r=>r.id==='email-0'),'old email change is outside first page');
  oneRecord(await read('/api/operations?kind=emailAdmin&id=email-0'),'email-0','email link finds exact old record');
  check((await read('/api/operations?kind=email&id=email-0',f.member)).records.length===1,'member can view their exact email request');
  check((await read('/api/operations?kind=email',f.member)).canRequest===true,'password member can start email verification');
  await f.run("UPDATE email_change_requests SET member_id='other' WHERE id='email-0'");
  check((await read('/api/operations?kind=email&id=email-0',f.member)).records.length===0,'exact email query cannot expose another member');
  check((await f.request(f.member,'/api/operations?kind=emailAdmin&id=email-0')).status===403,'member cannot elevate exact email query');
  check(!(await read('/api/community?kind=reports')).records.some(r=>r.id==='report-114'),'report is outside moderation list limit');
  oneRecord(await read('/api/community?kind=reports&id=report-114'),'report-114','report link finds exact record');
  check((await f.request(f.member,'/api/community?kind=reports&id=report-114')).status===403,'exact report remains admin only');
  const team=await read('/api/community?kind=team&threadId=thread-0');check(team.thread.id==='thread-0'&&!team.records.some(r=>r.id==='thread-0'),'team link opens exact thread outside first page');
  check((await f.request(f.member,'/api/community?kind=team&threadId=thread-0')).status===403,'exact team thread remains admin only');
  check(!(await read('/api/history?dataset=pickups&scope=admin')).records.some(r=>r.order_id==='order-0'),'old pickup is outside first page');
  const pickup=await read('/api/history?dataset=pickups&scope=admin&orderId=order-0');check(pickup.records.length===1&&pickup.records[0].order_id==='order-0','pickup link opens exact old order');
  check((await read('/api/history?dataset=pickups&orderId=order-0',f.member)).records.length===0,'member cannot read another pickup through target');
  oneRecord(await read('/api/history?dataset=members&scope=admin&memberId=target-member-99'),'target-member-99','regular admin exact member query bypasses pagination');
  check((await f.request(f.member,'/api/history?dataset=members&scope=admin&memberId=target-member-99')).status===403,'exact member query remains admin only');
  for(const path of ['/api/community?kind=requests&id=absent','/api/operations?kind=emailAdmin&id=absent','/api/operations?kind=initiatives&admin=true&id=absent','/api/community?kind=reports&id=absent','/api/history?dataset=pickups&scope=admin&orderId=absent'])check((await read(path)).records.length===0,'missing task target is handled: '+path);
  const after=await f.one('SELECT (SELECT SUM(debt) FROM members) debt,(SELECT SUM(credit) FROM members) credit,(SELECT SUM(stock) FROM products) stock,(SELECT COUNT(*) FROM payments) payments,(SELECT COUNT(*) FROM money_movements) movements');
  check(JSON.stringify(before)===JSON.stringify(after),'opening task records never changes commerce');

  // Source completion, not an inbox metadata shortcut, removes the task.
  await post('/api/community',{action:'requestDecision',id:'request-0',version:0,status:'accepted',note:'Synthetic accepted decision'});
  await post('/api/community',{action:'resolveReport',id:'report-114',note:'Synthetic report reviewed'});
  await post('/api/community',{action:'teamUpdate',id:'thread-0',version:0,status:'resolved',pinned:0});
  let inbox=await read('/api/operations?kind=inbox&filter=all&taskKey=request:request-0');check(inbox.task.status==='resolved','request decision resolves its task');
  inbox=await read('/api/operations?kind=inbox&filter=all&taskKey=report:report-114');check(inbox.task.status==='resolved','report resolution resolves its task');
  inbox=await read('/api/operations?kind=inbox&filter=all&taskKey=team:thread-0');check(inbox.task.status==='resolved','answer completion resolves its task');

  // Recovery status is display-only. Issuing a code changes the task revision,
  // invalidating stale team edits and restoring its reminder.
  await f.run("INSERT INTO password_reset_requests(id,member_id,created_at) VALUES('reset-member','member',1)");
  inbox=await read('/api/operations?kind=inbox&type=reset&taskKey=reset:reset-member');
  const reset=inbox.task;check(reset.member_email==='member@example.test'&&reset.password_set===1&&!reset.recovery_expires_at,'reset task supplies account and actionable recovery state');
  check(!JSON.stringify(reset).includes('code_hash')&&!JSON.stringify(reset).includes('password_hash'),'task response never includes secrets');
  await post('/api/operations',{action:'taskBulk',operation:'snooze',items:[{taskKey:reset.task_key,version:reset.version,revision:reset.revision}],snoozeUntil:Date.now()+86400000});
  const recovery=await readResponse(f.request(f.admin,'/api/auth',{action:'issueRecovery',memberId:'member',identityVerified:true}),'issue recovery');
  inbox=await read('/api/operations?kind=inbox&type=reset&taskKey=reset:reset-member');
  check(inbox.records.length===1&&inbox.task.snoozed_until===null&&inbox.task.recovery_expires_at===recovery.expiresAt,'recovery issuance restores reminder with expiration');
  const stale=await post('/api/operations',{action:'taskBulk',operation:'assign',assignee:'owner',items:[{taskKey:reset.task_key,version:reset.version,revision:reset.revision}]});check(stale.applied===0&&stale.skipped===1,'old task snapshot cannot silently apply after recovery changes');
  await f.run("UPDATE auth_recovery SET expires_at=1 WHERE member_id='member'");
  inbox=await read('/api/operations?kind=inbox&type=reset');check(inbox.records[0].recovery_expires_at===1&&inbox.records[0].active===1,'expired recovery stays actionable without resolving request');
  check(f.outbound()===0,'audit uses no live providers');
  console.log(JSON.stringify({suite:'workflow-audit-http',checks,result:'passed'}));
}finally{await f.close()}

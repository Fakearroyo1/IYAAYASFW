// Disposable Miniflare/D1 fixtures exercise the compiled HTTP authorization boundary.
// These tests never call the live store or a production database.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {randomBytes,createHash} from 'node:crypto';
import {grantFixtureMfa,challengeBindings,challengeService} from './security-fixtures.mjs';
const require=createRequire(import.meta.url),{Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));
const mf=new Miniflare({cf:false,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],
 modules:[{type:'ESModule',path:resolve('dist/server/index.js')},...readdirSync('dist/server',{recursive:true}).filter(p=>p.endsWith('.js')&&p!=='index.js').map(p=>({type:'ESModule',path:resolve('dist/server',p)}))],
 modulesRoot:resolve('dist/server'),d1Databases:{DB:'experience-http-test-db'},r2Buckets:{BUCKET:'experience-http-test-bucket'},bindings:{...challengeBindings,OWNER_EMAIL:'owner@example.test'},outboundService:challengeService});
let checks=0;const ok=(v,message)=>{assert.ok(v,message);checks++};
try{
 const db=await mf.getD1Database('DB');
 for(const file of ['drizzle/0000_tiny_shape.sql','drizzle/0001_absent_guardsmen.sql','AUTH-SCHEMA.sql','PRODUCT-SCHEMA.sql','SECURITY-SCHEMA.sql','BETA-SCHEMA.sql','ROUNDS-SCHEMA.sql','GUEST-SCHEMA.sql','AUTOPILOT-SCHEMA.sql','REWARDS-SCHEMA.sql','EARNING-SCHEMA.sql','REDEMPTION-SCHEMA.sql','PROFILE-EXPERIENCE-SCHEMA.sql','ADMIN-EXPERIENCE-SCHEMA.sql'])await db.exec(readFileSync(file,'utf8').replace(/--> statement-breakpoint/g,'').replace(/^--.*$/gm,'').replace(/\n/g,' '));
 const run=(sql,...v)=>db.prepare(sql).bind(...v).run(),one=(sql,...v)=>db.prepare(sql).bind(...v).first();
 await run("INSERT INTO settings(id,enabled,cashtag) VALUES('main',1,'$UnitTest')");
 const cookies={};
 for(const [id,role] of [['owner','admin'],['locked','admin'],['member','member'],['other','member']]){
  await run('INSERT INTO members(id,user_id,email,name,role) VALUES(?,?,?,?,?)',id,id,id+'@example.test',id,role);
  await run('INSERT INTO auth_credentials(member_id,password_hash,updated_at) VALUES(?,?,?)',id,'test-unusable',Date.now());
  const token=randomBytes(32).toString('hex');
  await run('INSERT INTO auth_sessions(token_hash,member_id,created_at,expires_at) VALUES(?,?,?,?)',createHash('sha256').update(token).digest('hex'),id,Date.now(),Date.now()+3600000);
  cookies[id]='__Host-supply-session='+token;
 }
 await grantFixtureMfa(db,cookies.owner);
 const request=(who,path,body,origin='https://test.local')=>mf.dispatchFetch('https://test.local'+path,{method:body?'POST':'GET',headers:{Cookie:cookies[who]||'',...(origin===null?{}:{Origin:origin}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const post=(who,action,extra={},origin='https://test.local',path='/api/roadmap')=>request(who,path,{action,requestId:crypto.randomUUID(),...extra},origin);
 async function json200(response,label){const r=await response,j=await r.json();ok(r.status===200,label+': '+JSON.stringify(j));ok(r.headers.get('cache-control')?.includes('no-store'),label+' is not cached');return j;}
 const adminReads=['/api/roadmap?kind=redemptions&admin=true','/api/roadmap?kind=rewards&admin=true','/api/operations?kind=inbox'];
 for(const path of adminReads){
  for(const who of ['', 'member','locked'])ok((await request(who,path)).status===(who?403:401),path+' denies '+(who||'anonymous'));
  await json200(request('owner',path),path+' accepts verified administrator');
 }
 for(const path of ['/api/roadmap?kind=redemptions','/api/roadmap?kind=rewards'])ok((await request('',path)).status===401,'anonymous cannot read '+path);
 const adminActions=['redemptionRewardSave','raffleSave','raffleEntryAdd','raffleDraw','raffleExternalResult','rewardEarningSettings'];
 for(const action of adminActions)for(const who of ['','member','locked'])ok((await post(who,action)).status===(who?403:401),action+' denies '+(who||'anonymous')+' before validating data');
 for(const who of ['','member','locked'])ok((await post(who,'taskBulk',{operation:'review',items:[]},'https://test.local','/api/operations')).status===(who?403:401),'bulk tasks deny '+(who||'anonymous'));
 ok((await post('','rewardRedeem',{rewardId:'not-found',version:0})).status===401,'anonymous cannot redeem');
 for(const origin of ['https://attacker.example',null]){
  for(const action of ['rewardRedeem',...adminActions])ok((await post(action==='rewardRedeem'?'member':'owner',action,{},origin)).status===403,action+' rejects '+(origin?'foreign origin':'missing origin'));
  ok((await post('owner','taskBulk',{operation:'review',items:[]},origin,'/api/operations')).status===403,'taskBulk rejects '+(origin?'foreign origin':'missing origin'));
 }
 ok((await one('SELECT COUNT(*) n FROM reward_redemptions')).n===0&&(await one('SELECT COUNT(*) n FROM reward_raffles')).n===0&&(await one('SELECT version FROM earning_settings WHERE id=\'main\'')).version===0,'denied attempts have no reward or configuration effect');
 await json200(post('owner','rewardEarningSettings',{version:0,weeklyCapPoints:0,reason:'Test earning settings in isolated database'}),'verified administrator configures earning');
 for(const [id,points] of [['member',250],['other',900]])await run('INSERT INTO reward_ledger(id,member_id,amount,rule_id,source,actor,note,created_at) VALUES(?,?,?,?,?,?,?,?)','test-award-'+id,id,points,'manual','http-fixture','owner','Private award for '+id,Date.now());
 const reward=await json200(post('owner','redemptionRewardSave',{name:'Test store credit',description:'HTTP fixture',kind:'credit',points:100,creditCents:100,active:true}),'verified administrator creates reward');
 let mine=await json200(request('member','/api/roadmap?kind=redemptions&memberId=other'),'member reads own wallet despite another member parameter');
 ok(mine.wallet.available===250&&!('members' in mine),'member wallet cannot be changed by query parameter');
 const recognition=await json200(request('member','/api/roadmap?kind=rewards&memberId=other'),'member recognition remains scoped');
 ok(recognition.memberId==='member'&&recognition.ledger.every(x=>!x.note.includes('other')),'another member private award history is not returned');
 const redemptionBody={action:'rewardRedeem',requestId:crypto.randomUUID(),rewardId:reward.id,version:0,quantity:1,memberId:'other'};
 const redeemed=await json200(request('member','/api/roadmap',redemptionBody),'member redeems for the authenticated account');
 ok(redeemed.redemption.member_id==='member'&&(await one("SELECT credit FROM members WHERE id='member'")).credit===100&&(await one("SELECT credit FROM members WHERE id='other'")).credit===0,'forged memberId cannot divert store credit');
 const replay=await json200(request('member','/api/roadmap',redemptionBody),'HTTP retry returns existing redemption');
 ok(replay.replayed&&(await one("SELECT COUNT(*) n FROM reward_redemptions WHERE member_id='member'")).n===1&&(await one("SELECT credit FROM members WHERE id='member'")).credit===100,'HTTP retry cannot mint duplicate credit');
 mine=await json200(request('member','/api/roadmap?kind=redemptions'),'member updated wallet');ok(mine.wallet.available===150&&mine.redemptions.length===1,'redemption deducts wallet without changing earned points');
 const raffle=await json200(post('owner','raffleSave',{name:'Private entry fixture',description:'Synthetic test entries',mode:'external',active:true,startsAt:Date.now()-60000,endsAt:Date.now()+86400000}),'verified administrator creates raffle');
 for(const entrant of [{visitorName:'VISITOR-PRIVATE-SENTINEL'},{memberId:'other'},{memberId:'member'}]){
  const current=await one('SELECT version FROM reward_raffles WHERE id=?',raffle.id);
  await json200(post('owner','raffleEntryAdd',{raffleId:raffle.id,version:current.version,quantity:2,...entrant}),'verified administrator records isolated raffle entry');
 }
 const publicEntries=await json200(request('member','/api/roadmap?kind=redemptions&raffleId='+raffle.id+'&memberId=other'),'member raffle view is scoped');
 ok(publicEntries.entries.length===1&&publicEntries.entries[0].ticket_start===5,'member cannot enumerate another member or visitor ticket entries');
 ok(!JSON.stringify(publicEntries).includes('VISITOR-PRIVATE-SENTINEL')&&publicEntries.entries.every(e=>!('visitor_name' in e)&&!('member_name' in e)&&!('member_id' in e)),'visitor and member identities omitted from member entry records');
 const adminEntries=await json200(request('owner','/api/roadmap?kind=redemptions&admin=true&raffleId='+raffle.id),'verified administrator can reconcile raffle roster');
 ok(adminEntries.entries.length===3&&adminEntries.entries.some(e=>e.visitor_name==='VISITOR-PRIVATE-SENTINEL'),'authorized administrator sees complete roster');
 const foreignRedemption=await json200(request('other','/api/roadmap?kind=redemptions&memberId=member'),'other member cannot enumerate redemption history');ok(foreignRedemption.redemptions.length===0&&foreignRedemption.wallet.available===900,'redemption history belongs to session identity');
 await run("INSERT INTO audit(id,actor,kind,target,detail,created_at) VALUES('http-adjustment','owner','stock_adjusted','test-only','{}',?)",Date.now());
 const inbox=await json200(request('owner','/api/operations?kind=inbox&type=adjustment,profile'),'combined inbox filter under real Worker');
 const task=inbox.records.find(r=>r.task_key==='adjustment:http-adjustment');ok(!!task?.revision,'compiled inbox returns revision guard');
 const reviewed=await json200(post('owner','taskBulk',{operation:'review',items:[{taskKey:task.task_key,version:task.version,revision:task.revision}]},'https://test.local','/api/operations'),'verified administrator reviews notification through HTTP');ok(reviewed.applied===1&&reviewed.skipped===0,'bulk HTTP action updates workflow only');
 const ownerTokenHash=createHash('sha256').update(cookies.owner.split('=')[1]).digest('hex');
 await run('UPDATE auth_admin_access SET expires_at=? WHERE token_hash=?',Date.now()-1000,ownerTokenHash);
 ok((await request('owner','/api/roadmap?kind=redemptions&admin=true')).status===403,'expired MFA loses administrator read');
 ok((await post('owner','raffleDraw',{raffleId:raffle.id,version:3,confirmed:true})).status===403,'expired MFA cannot invoke draw');
 ok((await post('owner','taskBulk',{operation:'review',items:[]},'https://test.local','/api/operations')).status===403,'expired MFA cannot bulk edit');
 await run("UPDATE members SET active=0 WHERE id='other'");
 ok((await request('other','/api/roadmap?kind=redemptions')).status===401,'disabled member loses wallet access');
 ok((await post('other','rewardRedeem',{rewardId:reward.id,version:0,quantity:1})).status===401,'disabled member cannot redeem with old cookie');
 console.log(`Experience HTTP: ${checks} checks passed.`);
}finally{await mf.dispose();}

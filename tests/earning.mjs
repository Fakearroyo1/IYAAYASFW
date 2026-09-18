import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const out=path.resolve('.sites-runtime/earning-tests');
for(const f of fs.readdirSync('lib',{recursive:true}).filter(f=>f.endsWith('.ts'))){
 const dest=path.join(out,'lib',f.replace(/\.ts$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 fs.writeFileSync(dest,ts.transpileModule(fs.readFileSync(path.join('lib',f),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/from (["'])(\.{1,2}\/[^"']+)\1/g,'from "$2.mjs"'));
}
fs.writeFileSync(out+'/lib/pilot/owner.mjs',"export const OWNER_EMAIL='owner@example.test';");
const {EarningPlan,rewardCreditGrant,earningSummary,mutateEarning}=await import(out+'/lib/pilot/earning.mjs');
const {placeOrder}=await import(out+'/lib/pilot/orders.mjs');
const {mutate}=await import(out+'/lib/pilot/service.mjs');
const {verifyPayment,applyCredit,transactionDetail,correctionAmounts,correctTransaction}=await import(out+'/lib/pilot/transactions.mjs');
const {batchAtomic,stmt}=await import(out+'/lib/pilot/core.mjs');
const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
for(const f of ['drizzle/0000_tiny_shape.sql','drizzle/0001_absent_guardsmen.sql','AUTH-SCHEMA.sql','PRODUCT-SCHEMA.sql','SECURITY-SCHEMA.sql','BETA-SCHEMA.sql','ROUNDS-SCHEMA.sql','GUEST-SCHEMA.sql','AUTOPILOT-SCHEMA.sql','REWARDS-SCHEMA.sql'])sqlite.exec(fs.readFileSync(f,'utf8'));
const run=(sql,...v)=>sqlite.prepare(sql).run(...v), get=(sql,...v)=>sqlite.prepare(sql).get(...v);
class S{constructor(sql,v=[]){this.sql=sql;this.v=v}bind(...v){return new S(this.sql,v)}async first(){return get(this.sql,...this.v)||null}async all(){return {results:sqlite.prepare(this.sql).all(...this.v)}}async run(){return run(this.sql,...this.v)}}
const db={prepare:sql=>new S(sql),batch:async ss=>{sqlite.exec('BEGIN');try{const r=ss.map(s=>run(s.sql,...s.v));sqlite.exec('COMMIT');return r}catch(e){sqlite.exec('ROLLBACK');throw e}}};
run("INSERT INTO settings(id,enabled,cashtag) VALUES('main',1,'$earning-test')");
let counter=0;
function member(extra={}){const id='member-'+(++counter);run('INSERT INTO members(id,user_id,name,email,role,debt,credit,due_since) VALUES(?,?,?,?,?,?,?,?)',id,id,id,id+'@example.test',extra.role||'member',extra.debt||0,extra.credit||0,extra.debt?Date.now():null);return get('SELECT * FROM members WHERE id=?',id)}
const owner=member({role:'admin'}), legacy=member({debt:200});
run("INSERT INTO orders(id,code,fingerprint,member_id,payer,method,total,tax,cost,status,created_at) VALUES('legacy','HIST','legacy',?,'Legacy','tab',200,0,100,'tab',1)",legacy.id);
run("INSERT INTO reward_ledger(id,member_id,amount,rule_id,source,actor,note,created_at) VALUES('past',?,17,'manual','historical','owner','Previously earned',1)",legacy.id);
const originalOrders=JSON.stringify(sqlite.prepare('SELECT * FROM orders').all()),originalMembers=JSON.stringify(sqlite.prepare('SELECT * FROM members').all());
for(let i=0;i<2;i++)sqlite.exec(fs.readFileSync('EARNING-SCHEMA.sql','utf8'));
assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM orders').all()),originalOrders);
assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM members').all()),originalMembers);
assert.equal(get('SELECT SUM(amount) n FROM reward_ledger WHERE member_id=?',legacy.id).n,17);
assert.equal(get("SELECT enabled FROM reward_rules WHERE id='purchase'").enabled,0);
run("UPDATE reward_rules SET enabled=0 WHERE id='settlement'");
let checks=4;
const eq=(actual,expected,note)=>{assert.equal(actual,expected,note);checks++};
const bad=async(fn,re)=>{await assert.rejects(fn,re);checks++};
const fresh=m=>get('SELECT * FROM members WHERE id=?',m.id), settings=()=>get("SELECT * FROM settings WHERE id='main'");
const earned=m=>get("SELECT COALESCE(SUM(amount),0) n FROM reward_ledger WHERE member_id=? AND rule_id='spending'",m.id).n;
const rewardCredit=m=>get('SELECT reward_credit_cents n FROM earning_accounts WHERE member_id=?',m.id).n;
async function buy(m,price,{qty=1,method='tab',credit=0,tax=0,gear=false}={}){
 const productId=crypto.randomUUID(),id=crypto.randomUUID();
 run('INSERT INTO products(id,name,category,price,cost,tax_bp,stock,active) VALUES(?,?,?,?,?,?,?,1)',productId,'Test item',gear?'Gear':'Snacks',price,Math.floor(price/2),tax,100);
 const b={id,method,creditAmount:credit,items:[{id:productId,qty,price}]};
 const result=await placeOrder(db,fresh(m),b,settings());return {...result,body:b};
}
async function report(m,amount,purpose='settlement'){
 const id=crypto.randomUUID();run("INSERT INTO payments(id,fingerprint,member_id,purpose,method,amount,created_at) VALUES(?,?,?,?, 'cash',?,?)",id,id,m.id,purpose,amount,Date.now());return id;
}
async function confirm(id,amount){return verifyPayment(db,owner,{id,confirmed:true,...(amount==null?{}:{amountReceived:amount})},batchAtomic)}
async function settle(m,amount,received=amount){const id=await report(m,amount);await confirm(id,received);return id}
async function grant(m,amount){const id=crypto.randomUUID();await batchAtomic(db,[stmt(db,'UPDATE members SET credit=credit+? WHERE id=?',amount,m.id),...rewardCreditGrant(db,m.id,amount,id)]);return id}
async function correction(m,orderId,qty,method='credit'){
 const detail=await transactionDetail(db,orderId),selection=[{id:detail.items[0].id,qty,restock:false}],pending=detail.payments.find(p=>p.purpose==='purchase'&&p.status==='pending');
 const amounts=correctionAmounts(detail.order,detail.items,selection,detail.member,pending?.amount||0);
 const body={id:orderId,requestId:crypto.randomUUID(),revision:detail.order.revision,reason:'Verified returned merchandise',items:selection,expectedTotal:amounts.total,expectedDebtReduction:amounts.debtReduced,expectedReturn:amounts.toReturn,refundMethod:method,confirmed:true};
 await correctTransaction(db,owner,body,batchAtomic);return amounts;
}
// Unpaid tabs have pending merchandise rewards; partial verified funding earns once.
const a=member();const aorder=await buy(a,125,{qty:3});
eq(earned(a),0,'unpaid cart earns no spendable points');eq((await earningSummary(db,a.id)).pendingCents,375);
const apay=await settle(a,175);eq(earned(a),1);eq((await earningSummary(db,a.id)).remainderCents,75);
await confirm(apay);eq(earned(a),1,'confirmation replay cannot award twice');
await settle(a,200);eq(earned(a),3);eq((await earningSummary(db,a.id)).pendingCents,0);
await placeOrder(db,fresh(a),aorder.body,settings());eq(earned(a),3,'order retry returns original record');
// Tax is excluded and pending gear only qualifies after payment confirmation.
const b=member();const border=await buy(b,107,{method:'cash',gear:true,tax:700});
eq(earned(b),0);await confirm(border.order.id);eq(earned(b),1);eq((await earningSummary(db,b.id)).remainderCents,0);
// Opening debt is settled ahead of new eligible merchandise and never backfilled.
await buy(legacy,100);await settle(legacy,200);eq(earned(legacy),0);await settle(legacy,100);eq(earned(legacy),1);
eq(get("SELECT amount FROM reward_ledger WHERE id='past'").amount,17);
// A cash overpayment is credit, not spending. It earns only when later consumed.
const c=member();await buy(c,100);await settle(c,100,300);eq(earned(c),1);eq(fresh(c).credit,200);
await buy(c,200,{method:'credit'});eq(earned(c),3);
// Reward credit cannot recursively mint points; funded-cash portions still qualify.
const d=member({credit:100});await grant(d,100);eq(rewardCredit(d),100);
const dorder=await buy(d,200,{method:'credit'});eq(earned(d),1);eq(rewardCredit(d),0);
await bad(()=>correction(d,dorder.order.id,1,'cash'),/reward-funded credit/);
eq(get('SELECT total FROM order_balances WHERE id=?',dorder.order.id).total,200,'failed refund leaves sale intact');
await correction(d,dorder.order.id,1,'credit');eq(earned(d),0);eq(fresh(d).credit,200);eq(rewardCredit(d),100);
await buy(d,200,{method:'credit'});eq(earned(d),1,'refunded credit provenance survives spending again');
// Partial refunds consume remaining tab first, then paid funding, proportionally.
const e=member();const eorder=await buy(e,250,{qty:2});await settle(e,400);eq(earned(e),4);
await correction(e,eorder.order.id,1);eq(fresh(e).debt,0);eq(fresh(e).credit,150);eq(earned(e),2);eq((await earningSummary(db,e.id)).remainderCents,50);
await correction(e,eorder.order.id,1);eq(earned(e),0);eq(fresh(e).credit,400);
// Returning a previously paid tab purchase can settle another current tab.
const f=member();const forder=await buy(f,100);await settle(f,100);await buy(f,100);
await correction(f,forder.order.id,1);eq(fresh(f).debt,0);eq(earned(f),1,'actual retained goods alone remain rewarded');
const oldRefund=member();await buy(oldRefund,100);
run("INSERT INTO products(id,name,category,price,cost,tax_bp,stock,active) VALUES('historical-refund-product','Old item','Snacks',100,50,0,0,1)");
run("INSERT INTO orders(id,code,fingerprint,member_id,payer,method,total,tax,cost,status,created_at) VALUES('historical-paid-tab','HIST-PAID','hist-paid',?,'Legacy buyer','tab',100,0,50,'tab',1)",oldRefund.id);
run("INSERT INTO order_items(id,order_id,product_id,name,qty,price,cost,tax_bp,preorder) VALUES('historical-paid-item','historical-paid-tab','historical-refund-product','Old item',1,100,50,0,0)");
await correction(oldRefund,'historical-paid-tab',1);eq(earned(oldRefund),1,'legacy refund may genuinely fund newly purchased goods without backfilling old order');
// Admin write-offs never earn; the next financial action reconciles allocation only.
const g=member();await buy(g,200);run('UPDATE members SET debt=100 WHERE id=?',g.id);await settle(g,100);eq(earned(g),1);
async function adjust(m,debt){const before=fresh(m);await mutate(db,{userId:owner.user_id,email:owner.email},{action:'member',requestId:crypto.randomUUID(),id:m.id,email:before.email,name:before.name,debt,credit:before.credit,tabLimit:3000,previousDebt:before.debt,previousCredit:before.credit,previousRole:before.role,reason:'Reviewed administrative debt correction'});}
const adjusted=member();await buy(adjusted,1000);await adjust(adjusted,0);await adjust(adjusted,1000);await settle(adjusted,1000);
eq(earned(adjusted),0,'write-off followed by manual new debt cannot resurrect old spending');
eq(get('SELECT forgiven_cents n FROM earning_orders WHERE member_id=?',adjusted.id).n,1000);
// A forgiven purchase is not paid funding for a later tab or its spending reward.
const writeOffReturn=member();const writtenOffOrder=await buy(writeOffReturn,1000);
await adjust(writeOffReturn,0);await buy(writeOffReturn,1000);
await bad(()=>correction(writeOffReturn,writtenOffOrder.order.id,1),/prior tab write-off/);
eq(fresh(writeOffReturn).debt,1000,'returning forgiven debt cannot erase a later tab');
eq(earned(writeOffReturn),0,'returning forgiven debt cannot mint spending rewards');
eq(get('SELECT total FROM order_balances WHERE id=?',writtenOffOrder.order.id).total,1000,'blocked return leaves the original purchase intact');
eq(get('SELECT COUNT(*) n FROM transaction_adjustments WHERE order_id=?',writtenOffOrder.order.id).n,0,'blocked return creates no financial adjustment');
// Correcting only the still-unpaid part remains valid after a partial write-off.
const partialWriteOff=member();const partialWriteOffOrder=await buy(partialWriteOff,250,{qty:2});
await adjust(partialWriteOff,250);await correction(partialWriteOff,partialWriteOffOrder.order.id,1);
eq(fresh(partialWriteOff).debt,0,'an unpaid portion can still be cancelled');
eq(fresh(partialWriteOff).credit,0,'cancelling an unpaid portion issues no credit');
eq(earned(partialWriteOff),0,'cancelling an unpaid portion earns no points');
eq(get('SELECT forgiven_cents n FROM earning_orders WHERE order_id=?',partialWriteOffOrder.order.id).n,250,'prior write-off remains recorded');
// Freeze prevents new accrual; no later hidden backfill when unfreezing.
const h=member({credit:200});run('INSERT INTO reward_members(member_id,frozen) VALUES(?,1)',h.id);await buy(h,100,{method:'credit'});eq(earned(h),0);
run('UPDATE reward_members SET frozen=0 WHERE member_id=?',h.id);await buy(h,100,{method:'credit'});eq(earned(h),1);
// Weekly cap snapshots and refunds do not claw back points that were never granted.
await mutateEarning(db,owner,{action:'rewardEarningSettings',requestId:crypto.randomUUID(),weeklyCapPoints:2,version:0,reason:'Testing optional capped weekly issuance'});
const cap=member({credit:500});const caporder=await buy(cap,100,{qty:5,method:'credit'});eq(earned(cap),2);
await correction(cap,caporder.order.id,1);eq(earned(cap),2,'refund of excess capped spend does not remove awarded points');
await correction(cap,caporder.order.id,4);eq(earned(cap),0);
await mutateEarning(db,owner,{action:'rewardEarningSettings',requestId:crypto.randomUUID(),weeklyCapPoints:0,version:1,reason:'Restore uncapped default for subsequent weeks'});
// Fractional carry survives a UTC week boundary.
const realNow=Date.now;let now=Date.UTC(2026,9,5,12);Date.now=()=>now;
try{
 const carry=member({credit:400});await buy(carry,275,{method:'credit'});eq(earned(carry),2);
 now+=604800000;await buy(carry,125,{method:'credit'});eq(earned(carry),4);eq((await earningSummary(db,carry.id)).remainderCents,0);
}finally{Date.now=realNow}
// A refund must never turn forfeited capped cents into a later week's new point.
await mutateEarning(db,owner,{action:'rewardEarningSettings',requestId:crypto.randomUUID(),weeklyCapPoints:1,version:2,reason:'Verify capped carry refund safety'});
now=Date.UTC(2026,9,12,12);Date.now=()=>now;
try{
 const cappedCarry=member({credit:300});const original=await buy(cappedCarry,50,{qty:4,method:'credit'});eq(earned(cappedCarry),1);
 now+=604800000;await buy(cappedCarry,50,{method:'credit'});eq(earned(cappedCarry),1);
 await correction(cappedCarry,original.order.id,1);eq(earned(cappedCarry),1,'refund cannot create a carry point');
 await correction(cappedCarry,original.order.id,3);eq(earned(cappedCarry),0,'full refund releases obsolete carry suppression');
 await buy(cappedCarry,50,{method:'credit'});eq(earned(cappedCarry),1,'new eligible money still earns normally after suppression clears');
}finally{Date.now=realNow}
await mutateEarning(db,owner,{action:'rewardEarningSettings',requestId:crypto.randomUUID(),weeklyCapPoints:0,version:3,reason:'Restore standard uncapped new weeks'});
// Reward-credit repayment must not farm the retained on-time settlement bonus.
run("UPDATE reward_rules SET enabled=1 WHERE id='settlement'");
const bonus=member();await buy(bonus,100);await grant(bonus,100);await applyCredit(db,fresh(bonus),{id:crypto.randomUUID(),amount:100},batchAtomic);
eq(earned(bonus),0);eq(get("SELECT COALESCE(SUM(amount),0) n FROM reward_ledger WHERE member_id=? AND rule_id='settlement'",bonus.id).n,0);
await buy(bonus,100);await grant(bonus,50);await applyCredit(db,fresh(bonus),{id:crypto.randomUUID(),amount:50},batchAtomic);await settle(bonus,50);
eq(get("SELECT COALESCE(SUM(amount),0) n FROM reward_ledger WHERE member_id=? AND rule_id='settlement'",bonus.id).n,0,'mixed reward-funded tab cycle cannot mint settlement bonus');
await buy(bonus,100);await settle(bonus,100);eq(get("SELECT COALESCE(SUM(amount),0) n FROM reward_ledger WHERE member_id=? AND rule_id='settlement'",bonus.id).n,10,'next externally funded tab cycle retains bonus');
// Conditional guards reject a stale concurrent plan and roll all records back.
const concurrent=member({credit:100});const one=await EarningPlan.load(db,concurrent.id,'concurrency-one','test'),two=await EarningPlan.load(db,concurrent.id,'concurrency-two','test');
await batchAtomic(db,[...one.prefixes,...one.finish()]);await bad(()=>batchAtomic(db,[...two.prefixes,...two.finish()]),/record changed/);
eq(get("SELECT COUNT(*) n FROM earning_operations WHERE id='concurrency-two'").n,0);
const beforeGrant=rewardCredit(concurrent);await bad(()=>batchAtomic(db,rewardCreditGrant(db,concurrent.id,101,'too-large-grant')),/record changed/);eq(rewardCredit(concurrent),beforeGrant);eq(get("SELECT COUNT(*) n FROM earning_credit_grants WHERE source_id='too-large-grant'").n,0);
// Full release replay leaves ledger records and account values unchanged.
const stateBefore=JSON.stringify(sqlite.prepare('SELECT * FROM reward_ledger ORDER BY id').all());
sqlite.exec(fs.readFileSync('REWARDS-SCHEMA.sql','utf8'));sqlite.exec(fs.readFileSync('EARNING-SCHEMA.sql','utf8'));
eq(JSON.stringify(sqlite.prepare('SELECT * FROM reward_ledger ORDER BY id').all()),stateBefore);
eq(get("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name IN('reward_purchase_insert','reward_purchase_paid')").n,0);
eq(get('SELECT COUNT(*) n FROM earning_periods p WHERE p.remaining_cents<>(SELECT COALESCE(SUM(s.remaining_cents),0) FROM earning_sources s WHERE s.period_id=p.id)').n,0,'cached weekly totals equal provenance-source totals');
console.log(`Earning accounting: ${checks} checks passed.`);

import {catalog} from './catalog';
import {OWNER_EMAIL} from './owner';
type DB=D1Database; type Row=Record<string,any>;
export class PilotError extends Error{constructor(message:string,public status=400){super(message)}}
function fail(m:string,s=400):never{throw new PilotError(m,s)}
const int=(v:any,min=0,max=1000000)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail('Enter a valid whole-number amount.');return v as number};
const str=(v:any,max=200)=>{if(typeof v!=='string'||v.length>max)fail('Enter valid text.');return v.trim()};
const uid=()=>crypto.randomUUID();
const reqId=(v:any)=>{const s=str(v,40);if(!/^[0-9a-f-]{36}$/.test(s))fail('Invalid request identifier.');return s};
const first=async(db:DB,sql:string,...v:any[])=>db.prepare(sql).bind(...v).first<Row>();
const rows=async(db:DB,sql:string,...v:any[])=>(await db.prepare(sql).bind(...v).all<Row>()).results;
const stmt=(db:DB,sql:string,...v:any[])=>db.prepare(sql).bind(...v);
const audit=(db:DB,actor:string,kind:string,target:string,detail:any)=>stmt(db,'INSERT INTO audit(id,actor,kind,target,detail,created_at) VALUES(?,?,?,?,?,?)',uid(),actor,kind,target,JSON.stringify(detail),Date.now());
const guard=(db:DB,condition:string,...values:any[])=>stmt(db,`INSERT INTO guards(id,valid) VALUES(?,CASE WHEN (${condition}) THEN 1 ELSE 0 END)`,uid(),...values);
const hash=async(v:any)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))).map(x=>x.toString(16).padStart(2,'0')).join('');
async function batchAtomic(db:DB,statements:D1PreparedStatement[]){try{return await db.batch([...statements,stmt(db,'DELETE FROM guards')])}catch(e){if(/constraint|unique/i.test(String(e)))fail('The record changed or this action was already recorded. Refresh and check before trying again.',409);throw e}}
export async function initialize(db:DB){if(await first(db,"SELECT id FROM settings WHERE id='main'"))return;await db.batch([
 stmt(db,"INSERT OR IGNORE INTO settings(id) VALUES('main')"),
 ...catalog.map((p,i)=>stmt(db,'INSERT OR IGNORE INTO products(id,name,category,detail,image,preorder,position) VALUES(?,?,?,?,?,?,?)',p.id,p.name,p.category,p.detail,p.image||null,p.preorder||0,i)),
 stmt(db,"INSERT OR IGNORE INTO members(id,email,name,role) VALUES(?,?,?,'admin')",'owner',OWNER_EMAIL,'Jake')
])}
export async function identity(db:DB,user:{userId:string;email:string}|null){
 if(!user)return null;
 let m=await first(db,'SELECT * FROM members WHERE user_id=?',user.userId);
 if(!m){const invite=await first(db,'SELECT * FROM members WHERE email=? AND user_id IS NULL AND active=1',user.email.toLowerCase());if(invite){await stmt(db,'UPDATE members SET user_id=? WHERE id=? AND user_id IS NULL',user.userId,invite.id).run();m=await first(db,'SELECT * FROM members WHERE user_id=?',user.userId)}}
 return m?.active?m:null;
}
export async function readState(db:DB,user:{userId:string;email:string}|null){
 await initialize(db);const m=await identity(db,user);if(!m)fail('Member access is required.',403);const settings=await first(db,"SELECT * FROM settings WHERE id='main'");
 const products=await rows(db,'SELECT * FROM products ORDER BY position,name');
 const publicProducts=products.filter(p=>p.category!=='Gear'||m).map(({cost,...p})=>m?.role==='admin'?{...p,cost}:p);
 const result:Row={settings,products:publicProducts,member:m,signedIn:!!user,processor:{connected:false,provider:'none'},orders:[],payments:[]};
 if(m){result.orders=await rows(db,'SELECT * FROM orders WHERE member_id=? ORDER BY created_at DESC',m.id);result.payments=await rows(db,'SELECT * FROM payments WHERE member_id=? ORDER BY created_at DESC',m.id)}
 if(m?.role==='admin'){
  const [orders,payments,members,items,events,expenses]=await Promise.all([
   rows(db,'SELECT * FROM orders ORDER BY created_at DESC'),rows(db,'SELECT p.*,m.name member_name,o.code order_code,o.payer FROM payments p LEFT JOIN members m ON m.id=p.member_id LEFT JOIN orders o ON o.id=p.order_id ORDER BY p.created_at DESC'),rows(db,'SELECT m.*,EXISTS(SELECT 1 FROM auth_credentials c WHERE c.member_id=m.id) AS password_set FROM members m ORDER BY name'),rows(db,'SELECT * FROM order_items'),rows(db,'SELECT * FROM audit ORDER BY created_at DESC'),rows(db,'SELECT * FROM expenses ORDER BY created_at DESC')]);
  result.admin={orders,payments,members,items,events,expenses};
 }
 return result;
}
async function duplicate(db:DB,table:'orders'|'payments',id:string,fingerprint:string){const existing=await first(db,`SELECT * FROM ${table} WHERE id=?`,id);if(existing&&existing.fingerprint!==fingerprint)fail('This request identifier has already been used.',409);return existing}
export async function mutate(db:DB,user:{userId:string;email:string}|null,b:Row){
 await initialize(db);const m=await identity(db,user);if(!m)fail('Member access is required.',403);const actor=m.id;const admin=()=>{if(m?.role!=='admin')fail('Administrator access is required.',403)};const member=()=>{if(!m)fail('Member access is required.',403);return m!};const settings=(await first(db,"SELECT * FROM settings WHERE id='main'"))!;
 const isAdminAction=!['order','payment'].includes(b.action);const operationId=isAdminAction?reqId(b.requestId):null;const operationFp=isAdminAction?await hash({actor,body:b}):null;
 const atomic=async(db:DB,statements:D1PreparedStatement[])=>batchAtomic(db,isAdminAction?[...statements,stmt(db,'INSERT INTO mutations(id,fingerprint) VALUES(?,?)',operationId,operationFp)]:statements);
 if(b.action==='order'){
  const id=reqId(b.id),method=str(b.method,20);if(!['cash','cashapp','tab','credit'].includes(method))fail('Choose an available payment method.');
  if(['tab','credit'].includes(method))member();
  const payer=m?.name||str(b.payer||'Guest',80)||'Guest';
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>30)fail('Select between 1 and 30 products.');
  const items=b.items.map((v:Row)=>({id:str(v.id,80),qty:int(v.qty,1,30),price:int(v.price,1,100000)})).sort((a:Row,c:Row)=>a.id.localeCompare(c.id));
  if(new Set(items.map((i:Row)=>i.id)).size!==items.length)fail('Combine duplicate products in the basket.');
  const fp=await hash({actor,payer,method,items});const old=await duplicate(db,'orders',id,fp);if(old)return {order:old,replayed:true};
  if(!settings.enabled)fail('Checkout is paused while the store is being set up.');if(method==='cashapp'&&!settings.cashtag)fail('Cash App is not configured yet.');
  const ps=await rows(db,'SELECT * FROM products');let total=0,tax=0,cost:number|null=0;
  const lines=items.map((item:Row):Row=>{const p=ps.find(p=>p.id===item.id);if(!p||!p.active||p.price===null||p.tax_bp===null)fail('One of these products is not ready for sale.');if(p.category==='Gear'&&!m)fail('Unit gear is available to invited members.',403);if(p.category==='Gear'&&method==='tab')fail('Unit gear must be paid upfront.');if(p.price!==item.price)fail('A price changed. Refresh your basket before checking out.',409);if(!p.preorder&&p.stock<item.qty)fail(`${p.name} has insufficient stock.`,409);total+=p.price*item.qty;tax+=Math.round(p.price*item.qty*p.tax_bp/(10000+p.tax_bp));cost=cost===null||p.cost===null?null:cost+p.cost*item.qty;return {...p,qty:item.qty}});
  if(total>50000)fail('Keep each pilot purchase under $500.');
  const time=Date.now(),code='SB-'+id.slice(0,8).toUpperCase(),status=method==='tab'?'tab':method==='credit'?'paid':'pending';
  const statements=[guard(db,"EXISTS(SELECT 1 FROM settings WHERE id='main' AND enabled=1)")];
  for(const p of lines){statements.push(guard(db,'EXISTS(SELECT 1 FROM products WHERE id=? AND version=? AND active=1 AND (preorder=1 OR stock>=?))',p.id,p.version,p.qty));if(!p.preorder)statements.push(stmt(db,'UPDATE products SET stock=stock-? WHERE id=?',p.qty,p.id))}
  if(method==='tab'){statements.push(guard(db,'EXISTS(SELECT 1 FROM members WHERE id=? AND active=1 AND debt+?<=tab_limit)',m!.id,total),stmt(db,'UPDATE members SET due_since=CASE WHEN debt=0 THEN ? ELSE due_since END,debt=debt+? WHERE id=?',time,total,m!.id))}
  if(method==='credit'){statements.push(guard(db,'EXISTS(SELECT 1 FROM members WHERE id=? AND active=1 AND credit>=?)',m!.id,total),stmt(db,'UPDATE members SET credit=credit-? WHERE id=?',total,m!.id))}
  statements.push(stmt(db,'INSERT INTO orders(id,code,fingerprint,member_id,payer,method,total,tax,cost,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,code,fp,m?.id||null,payer,method,total,tax,cost,status,time));
  for(const p of lines)statements.push(stmt(db,'INSERT INTO order_items(id,order_id,product_id,name,qty,price,cost,tax_bp,preorder) VALUES(?,?,?,?,?,?,?,?,?)',uid(),id,p.id,p.name,p.qty,p.price,p.cost,p.tax_bp,p.preorder));
  if(status==='pending')statements.push(stmt(db,"INSERT INTO payments(id,fingerprint,order_id,member_id,purpose,method,amount,created_at) VALUES(?,?,?,?,'purchase',?,?,?)",id,fp,id,m?.id||null,method,total,time));
  statements.push(audit(db,actor,'consumption',id,{items,total,method}));
  try{await atomic(db,statements)}catch(e){const retry=await duplicate(db,'orders',id,fp);if(retry)return{order:retry,replayed:true};throw e}
  return{order:await first(db,'SELECT * FROM orders WHERE id=?',id)};
 }
 if(b.action==='payment'){
  const who=member(),id=reqId(b.id),purpose=str(b.purpose,20),method=str(b.method,20),amount=int(b.amount,1,50000);
  if(!['settlement','topup'].includes(purpose)||!['cash','cashapp'].includes(method))fail('Invalid payment type.');if(method==='cashapp'&&!settings.cashtag)fail('Cash App is not configured yet.');
  const fp=await hash({actor,purpose,method,amount});const old=await duplicate(db,'payments',id,fp);if(old)return{payment:old,replayed:true};
  const statements=[];if(purpose==='settlement')statements.push(guard(db,"? <= (SELECT debt FROM members WHERE id=?) - COALESCE((SELECT SUM(amount) FROM payments WHERE member_id=? AND purpose='settlement' AND status='pending'),0)",amount,who.id,who.id));
  statements.push(stmt(db,'INSERT INTO payments(id,fingerprint,member_id,purpose,method,amount,created_at) VALUES(?,?,?,?,?,?,?)',id,fp,who.id,purpose,method,amount,Date.now()),audit(db,actor,'payment_reported',id,{purpose,method,amount}));
  try{await atomic(db,statements)}catch(e){const old=await duplicate(db,'payments',id,fp);if(old)return{payment:old,replayed:true};throw e}return{payment:await first(db,'SELECT * FROM payments WHERE id=?',id)};
 }
 admin();
 const previous=await first(db,'SELECT fingerprint FROM mutations WHERE id=?',operationId);if(previous){if(previous.fingerprint!==operationFp)fail('This action identifier was already used.',409);return{ok:true,replayed:true}}
 if(b.action==='settings'){
  const cashtag=str(b.cashtag||'',30).replace(/^\$/,'');if(cashtag&&!/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(cashtag))fail('Enter the Cash App tag without spaces.');const enabled=b.enabled===true?1:0;
  if(enabled&&!(await first(db,'SELECT id FROM products WHERE active=1 AND price IS NOT NULL AND tax_bp IS NOT NULL LIMIT 1')))fail('Configure at least one product before opening checkout.');
  await atomic(db,[stmt(db,"UPDATE settings SET enabled=?,cashtag=?,cash_instructions=?,reminder_days=? WHERE id='main'",enabled,cashtag,str(b.cashInstructions,400),int(b.reminderDays,1,90)),audit(db,actor,'settings','main',{enabled,cashtag})]);return{ok:true};
 }
 if(b.action==='product'){
  const id=b.id?str(b.id,80):uid(),old=await first(db,'SELECT * FROM products WHERE id=?',id),name=str(b.name,100),category=str(b.category,20),detail=str(b.detail||'',160),price=b.price===null?null:int(b.price,1,100000),cost=b.cost===null?null:int(b.cost),tax=b.taxBp===null?null:int(b.taxBp,0,3000),stock=int(b.stock,0,100000),reorder=int(b.reorder,0,10000),active=b.active===true?1:0,preorder=b.preorder===true?1:0,reason=str(b.reason||'',200);
  if(!name||!['Drinks','Snacks','Frozen','Gear'].includes(category))fail('Enter a product name and category.');if(active&&(price===null||tax===null))fail('Set a price and tax treatment before making this product available.');if(preorder&&category!=='Gear')fail('Preorders are only available for gear.');if(old&&old.stock!==stock&&!reason)fail('Give a reason for the stock adjustment.');
  const image=b.image===undefined?(old?.image||null):b.image===null?null:str(b.image,500);if(image&&!/^\/(?:products\/|api\/product-images\?id=)[a-zA-Z0-9_./?=\-]+$/.test(image))fail('Upload a valid product image.');
  const statements=[];if(old)statements.push(guard(db,'EXISTS(SELECT 1 FROM products WHERE id=? AND version=? AND stock=?)',id,int(b.version),int(b.previousStock)));
  statements.push(stmt(db,`INSERT INTO products(id,name,category,detail,image,price,cost,tax_bp,stock,reorder,active,preorder,position) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,detail=excluded.detail,image=excluded.image,price=excluded.price,cost=excluded.cost,tax_bp=excluded.tax_bp,stock=excluded.stock,reorder=excluded.reorder,active=excluded.active,preorder=excluded.preorder,version=products.version+1`,id,name,category,detail,image,price,cost,tax,stock,reorder,active,preorder,old?.position||99),audit(db,actor,'product_updated',id,{before:old,after:{name,category,image,price,cost,tax,stock,reorder,active,preorder},reason}));await atomic(db,statements);return{ok:true};
 }
 if(b.action==='receive'){
  const id=str(b.id,80),qty=int(b.qty,1,100000),amount=int(b.amount,1,10000000),reference=str(b.reference,200);if(!reference)fail('Enter the Costco receipt reference.');const p=await first(db,'SELECT * FROM products WHERE id=?',id);if(!p||p.preorder)fail('Choose a stocked product.');const cost=p.stock===0?Math.round(amount/qty):p.cost===null?null:Math.round((p.stock*p.cost+amount)/(p.stock+qty));
  await atomic(db,[guard(db,'EXISTS(SELECT 1 FROM products WHERE id=? AND stock=? AND version=?)',id,p.stock,p.version),stmt(db,'UPDATE products SET stock=stock+?,cost=?,version=version+1 WHERE id=?',qty,cost,id),stmt(db,'INSERT INTO expenses(id,kind,amount,description,created_at) VALUES(?,?,?,?,?)',uid(),'stock',amount,reference,Date.now()),audit(db,actor,'stock_received',id,{qty,amount,reference,previousStock:p.stock,newCost:cost})]);return{ok:true};
 }
 if(b.action==='member'){
  const email=str(b.email,200).toLowerCase(),name=str(b.name,80);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!name)fail('Enter a name and email address.');
  const old=await first(db,'SELECT * FROM members WHERE email=?',email),id=old?.id||uid(),debt=int(b.debt,0,100000),credit=int(b.credit,0,100000),limit=int(b.tabLimit,0,100000),reason=str(b.reason||'',200),active=b.active!==false?1:0;
  if(old?.role==='admin'&&!active)fail('The owner account must stay active.');if((debt!==(old?.debt||0)||credit!==(old?.credit||0))&&!reason)fail('Record the source or reason for the balance adjustment.');
  const statements=[];if(!active)statements.push(stmt(db,'DELETE FROM auth_sessions WHERE member_id=?',id));if(old)statements.push(guard(db,'EXISTS(SELECT 1 FROM members WHERE id=? AND debt=? AND credit=?)',id,int(b.previousDebt),int(b.previousCredit)));
  statements.push(guard(db,"? >= COALESCE((SELECT SUM(amount) FROM payments WHERE member_id=? AND purpose='settlement' AND status='pending'),0)",debt,id));
  statements.push(stmt(db,`INSERT INTO members(id,email,name,debt,credit,tab_limit,due_since,active) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,debt=excluded.debt,credit=excluded.credit,tab_limit=excluded.tab_limit,due_since=excluded.due_since,active=excluded.active`,id,email,name,debt,credit,limit,debt?(old?.due_since||Date.now()):null,active),audit(db,actor,'member_updated',id,{before:old,after:{name,email,debt,credit,limit,active},reason}));await atomic(db,statements);return{ok:true};
 }
 if(b.action==='verify'){
  const p=await first(db,'SELECT * FROM payments WHERE id=?',str(b.id,40));if(!p)fail('Payment not found.',404);if(p.status==='verified')return{ok:true,replayed:true};if(p.status!=='pending')fail('This payment is no longer pending.',409);
  const reference=str(b.reference,100);if(!reference)fail('Enter the Cash App transaction ID or a unique cash receipt reference.');if(b.confirmed!==true)fail('Confirm you have actually received this payment.');
  const statements=[guard(db,"EXISTS(SELECT 1 FROM payments WHERE id=? AND status='pending')",p.id)];
  if(p.purpose==='settlement')statements.push(guard(db,'EXISTS(SELECT 1 FROM members WHERE id=? AND debt>=?)',p.member_id,p.amount),stmt(db,'UPDATE members SET debt=debt-?,due_since=CASE WHEN debt-?=0 THEN NULL ELSE due_since END WHERE id=?',p.amount,p.amount,p.member_id));
  if(p.purpose==='topup')statements.push(stmt(db,'UPDATE members SET credit=credit+? WHERE id=?',p.amount,p.member_id));
  if(p.order_id)statements.push(stmt(db,"UPDATE orders SET status='paid' WHERE id=?",p.order_id));
  statements.push(stmt(db,"UPDATE payments SET status='verified',reference=?,verified_by=?,verified_at=? WHERE id=?",reference.toLowerCase(),actor,Date.now(),p.id),audit(db,actor,'payment_verified',p.id,{reference,amount:p.amount,method:p.method,purpose:p.purpose}));await atomic(db,statements);return{ok:true};
 }
 if(b.action==='reject'){
  const p=await first(db,'SELECT * FROM payments WHERE id=?',str(b.id,40)),reason=str(b.reason,200);if(!p||p.status!=='pending'||!reason)fail('Choose a pending payment and give a reason.');if(p.purpose==='purchase'&&b.returned!==true)fail('Only void a purchase when the goods were not taken or were returned.');
  const statements=[guard(db,"EXISTS(SELECT 1 FROM payments WHERE id=? AND status='pending')",p.id),stmt(db,"UPDATE payments SET status='rejected' WHERE id=?",p.id)];
  if(p.order_id){const items=await rows(db,'SELECT * FROM order_items WHERE order_id=?',p.order_id);statements.push(stmt(db,"UPDATE orders SET status='void' WHERE id=?",p.order_id));for(const item of items)if(!item.preorder)statements.push(stmt(db,'UPDATE products SET stock=stock+? WHERE id=?',item.qty,item.product_id))}
  statements.push(audit(db,actor,'payment_rejected',p.id,{reason,returned:!!b.returned}));await atomic(db,statements);return{ok:true};
 }
 if(b.action==='expense'||b.action==='cashcount'){
  const description=str(b.description,200),amount=int(b.amount,0,10000000);if(!description)fail('Enter a description or counter names.');
  const statements=[audit(db,actor,b.action,'fund',{amount,description})];if(b.action==='expense')statements.push(stmt(db,'INSERT INTO expenses(id,kind,amount,description,created_at) VALUES(?,?,?,?,?)',uid(),'morale',amount,description,Date.now()));await atomic(db,statements);return{ok:true};
 }
 fail('Unknown action.');
}

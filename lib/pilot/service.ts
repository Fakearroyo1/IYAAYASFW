import {catalog} from './catalog';
import {OWNER_EMAIL} from './owner';
import {type DB,type Row,PilotError,fail,int,str,uid,ownerAccount,reqId,first,rows,stmt,audit,guard,hash,batchAtomic} from './core';
import {accessFor,canShop} from './access';
import {catalogState,extendedMutation} from './products';
import {placeOrder} from './orders';
export {PilotError} from './core';
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
 const access=await accessFor(db,m as any),products=await catalogState(db,m,access);
 const result:Row={settings,products,member:{...m,...access,isOwner:ownerAccount(m)},signedIn:!!user,processor:{connected:false,provider:'none'},orders:await rows(db,'SELECT * FROM orders WHERE member_id=? ORDER BY created_at DESC',m.id),payments:await rows(db,'SELECT * FROM payments WHERE member_id=? ORDER BY created_at DESC',m.id)};
 const itemSql="SELECT i.*,d.variant_id,d.variant_label,d.personalization,d.fulfillment,d.updated_at fulfillment_updated_at FROM order_items i LEFT JOIN order_item_details d ON d.item_id=i.id";
 result.items=await rows(db,itemSql+' JOIN orders o ON o.id=i.order_id WHERE o.member_id=?',m.id);
 if(m.role==='admin'){
  const [orders,payments,members,items,events,expenses,resets,restocks]=await Promise.all([
   rows(db,'SELECT * FROM orders ORDER BY created_at DESC'),rows(db,'SELECT p.*,m.name member_name,o.code order_code,o.payer FROM payments p LEFT JOIN members m ON m.id=p.member_id LEFT JOIN orders o ON o.id=p.order_id ORDER BY p.created_at DESC'),rows(db,"SELECT m.*,COALESCE(a.snacks,1) snacks,COALESCE(a.gear,1) gear,EXISTS(SELECT 1 FROM auth_credentials c WHERE c.member_id=m.id) AS password_set,s.expires_at setup_expires_at FROM members m LEFT JOIN member_access a ON a.member_id=m.id LEFT JOIN auth_setup s ON s.member_id=m.id ORDER BY name"),rows(db,itemSql),rows(db,'SELECT * FROM audit ORDER BY created_at DESC'),rows(db,'SELECT * FROM expenses ORDER BY created_at DESC'),rows(db,"SELECT r.*,m.name,m.email FROM password_reset_requests r JOIN members m ON m.id=r.member_id WHERE r.status='pending' ORDER BY r.created_at"),rows(db,'SELECT * FROM restock_entries ORDER BY created_at DESC')]);
  result.admin={orders,payments,members:members.map(member=>({...member,isOwner:ownerAccount(member)})),items,events,expenses,resets,restocks};
 }

 return result;
}
async function duplicate(db:DB,table:'orders'|'payments',id:string,fingerprint:string){const existing=await first(db,`SELECT * FROM ${table} WHERE id=?`,id);if(existing&&existing.fingerprint!==fingerprint)fail('This request identifier has already been used.',409);return existing}
export async function mutate(db:DB,user:{userId:string;email:string}|null,b:Row){
 await initialize(db);const m=await identity(db,user);if(!m)fail('Member access is required.',403);const actor=m.id;const admin=()=>{if(m?.role!=='admin')fail('Administrator access is required.',403)};const member=()=>{if(!m)fail('Member access is required.',403);return m!};const settings=(await first(db,"SELECT * FROM settings WHERE id='main'"))!;
 const isAdminAction=!['order','payment'].includes(b.action);const operationId=isAdminAction?reqId(b.requestId):null;const operationFp=isAdminAction?await hash({actor,body:b}):null;
 const atomic=async(db:DB,statements:D1PreparedStatement[])=>batchAtomic(db,isAdminAction?[guard(db,"EXISTS(SELECT 1 FROM members WHERE id=? AND active=1 AND role='admin')",actor),...statements,stmt(db,'INSERT INTO mutations(id,fingerprint) VALUES(?,?)',operationId,operationFp)]:statements);
 if(b.action==='order')return placeOrder(db,m,b,settings);
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
 const extended=await extendedMutation(db,m,b,atomic);if(extended!==undefined)return extended;
 if(b.action==='shop'){
  if(typeof b.enabled!=='boolean'||typeof b.previousEnabled!=='boolean')fail('Choose whether to open or pause the shop.');
  if(b.enabled&&!(await first(db,'SELECT p.id FROM products p LEFT JOIN product_details d ON d.product_id=p.id WHERE p.active=1 AND COALESCE(d.archived,0)=0 AND p.tax_bp IS NOT NULL AND ((NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id) AND p.price>0 AND (p.preorder=1 OR p.stock>0)) OR EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active=1 AND COALESCE(v.price,p.price)>0 AND (v.preorder=1 OR v.stock>0))) LIMIT 1')))fail('Make at least one priced product available with stock, or available for preorder.');
  await atomic(db,[guard(db,"EXISTS(SELECT 1 FROM settings WHERE id='main' AND enabled=?)",b.previousEnabled?1:0),stmt(db,"UPDATE settings SET enabled=? WHERE id='main'",b.enabled?1:0),audit(db,actor,b.enabled?'checkout_opened':'checkout_paused','main',{enabled:b.enabled})]);return{ok:true};
 }
 if(b.action==='settings'){
  const cashtag=str(b.cashtag||'',30).replace(/^\$/,'');if(cashtag&&!/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(cashtag))fail('Enter the Cash App tag without spaces.');const enabled=b.enabled===undefined?settings.enabled:b.enabled===true?1:0;
  if(b.enabled===true&&!settings.enabled&&!(await first(db,'SELECT p.id FROM products p LEFT JOIN product_details d ON d.product_id=p.id WHERE p.active=1 AND COALESCE(d.archived,0)=0 AND p.tax_bp IS NOT NULL AND ((NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id) AND p.price>0 AND (p.preorder=1 OR p.stock>0)) OR EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active=1 AND COALESCE(v.price,p.price)>0 AND (v.preorder=1 OR v.stock>0))) LIMIT 1')))fail('Configure at least one product before opening checkout.');
  await atomic(db,[stmt(db,"UPDATE settings SET enabled=CASE WHEN ? THEN enabled ELSE ? END,cashtag=?,cash_instructions=?,reminder_days=? WHERE id='main'",b.enabled===undefined?1:0,enabled,cashtag,str(b.cashInstructions,400),int(b.reminderDays,1,90)),audit(db,actor,'settings','main',{enabled,cashtag})]);return{ok:true};
 }
 if(b.action==='product'){
  const id=b.id?str(b.id,80):uid(),old=await first(db,'SELECT * FROM products WHERE id=?',id),name=str(b.name,100),category=str(b.category,20),detail=str(b.detail||'',160),price=b.price===undefined?(old?.price??null):b.price===null?null:int(b.price,1,100000),cost=b.cost===undefined?(old?.cost??null):b.cost===null?null:int(b.cost),tax=b.taxBp===undefined?(old?.tax_bp??null):b.taxBp===null?null:int(b.taxBp,0,3000),stock=int(b.stock,0,100000),reorder=int(b.reorder,0,10000),active=b.active===true?1:0,preorder=b.preorder===true?1:0,reason=str(b.reason||'',200);
  if(price!==null&&category!=='Gear'&&b.price!==undefined&&price!==old?.price&&price%25)fail('Snack prices must round up to a multiple of $0.25.');
  if(old?.category==='Gear'&&category!=='Gear'&&await first(db,'SELECT id FROM product_variants WHERE product_id=? LIMIT 1',id))fail('Products with gear options must remain in Gear.');
  if(!name||!['Drinks','Snacks','Frozen','Gear'].includes(category))fail('Enter a product name and category.');if(active&&(price===null||tax===null))fail('Set a price and tax treatment before making this product available.');if(preorder&&category!=='Gear')fail('Preorders are only available for gear.');if(old&&old.stock!==stock&&!reason)fail('Give a reason for the stock adjustment.');
  const image=b.image===undefined?(old?.image||null):b.image===null?null:str(b.image,500);if(image&&!/^\/(?:products\/|api\/product-images\?id=)[a-zA-Z0-9_./?=\-]+$/.test(image))fail('Upload a valid product image.');
  const statements=[];if(old)statements.push(guard(db,'EXISTS(SELECT 1 FROM products WHERE id=? AND version=? AND stock=?)',id,int(b.version),int(b.previousStock)));
  statements.push(stmt(db,`INSERT INTO products(id,name,category,detail,image,price,cost,tax_bp,stock,reorder,active,preorder,position) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,detail=excluded.detail,image=excluded.image,price=excluded.price,cost=excluded.cost,tax_bp=excluded.tax_bp,stock=excluded.stock,reorder=excluded.reorder,active=excluded.active,preorder=excluded.preorder,version=products.version+1`,id,name,category,detail,image,price,cost,tax,stock,reorder,active,preorder,old?.position||99),audit(db,actor,'product_updated',id,{before:old,after:{name,category,image,price,cost,tax,stock,reorder,active,preorder},reason}));await atomic(db,statements);return{ok:true,productId:id};
 }
 if(b.action==='member'){
  const email=str(b.email,200).toLowerCase(),name=str(b.name,80);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!name)fail('Enter a name and email address.');
  const old=await first(db,'SELECT * FROM members WHERE email=?',email),id=old?.id||uid(),debt=int(b.debt,0,100000),credit=int(b.credit,0,100000),limit=int(b.tabLimit,0,100000),reason=str(b.reason||'',200),active=b.active!==false?1:0;
  if(b.id&&(!old||old.id!==b.id))fail('An existing member email cannot be changed. Refresh and edit the correct account.',409);
  const role=b.role===undefined?(old?.role||'member'):str(b.role,20),roleChanged=role!==(old?.role||'member');
  if(!['member','admin'].includes(role))fail('Choose Member or Administrator.');
  if(old?.role==='admin'&&!ownerAccount(m)&&old.id!==actor)fail('Only the owner can manage another administrator.',403);
  if(roleChanged&&!ownerAccount(m))fail('Only the owner can change administrator access.',403);
  if(old&&ownerAccount(old)&&(!active||role!=='admin'))fail('The owner account must stay active and remain an administrator.');
  if(roleChanged&&role==='admin'&&!active)fail('Enable member access before granting administrator access.');
  if((debt!==(old?.debt||0)||credit!==(old?.credit||0))&&!reason)fail('Record the source or reason for the balance adjustment.');
  const access=await accessFor(db,{id,role}),snacks=b.snacks===undefined?access.snacks:b.snacks===true?1:0,gear=b.gear===undefined?access.gear:b.gear===true?1:0;
  const statements=[];
  if(old)statements.push(guard(db,'COALESCE((SELECT snacks FROM member_access WHERE member_id=?),1)=? AND COALESCE((SELECT gear FROM member_access WHERE member_id=?),1)=?',id,access.snacks,id,access.gear));
  if(!active||roleChanged||snacks!==access.snacks||gear!==access.gear)statements.push(stmt(db,'DELETE FROM auth_sessions WHERE member_id=?',id));
  if(old)statements.push(guard(db,'EXISTS(SELECT 1 FROM members WHERE id=? AND debt=? AND credit=? AND role=? AND active=?)',id,int(b.previousDebt),int(b.previousCredit),b.previousRole===undefined?old.role:str(b.previousRole,20),old.active));
  statements.push(guard(db,"? >= COALESCE((SELECT SUM(amount) FROM payments WHERE member_id=? AND purpose='settlement' AND status='pending'),0)",debt,id));
  statements.push(stmt(db,`INSERT INTO members(id,email,name,role,debt,credit,tab_limit,due_since,active) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,role=excluded.role,debt=excluded.debt,credit=excluded.credit,tab_limit=excluded.tab_limit,due_since=excluded.due_since,active=excluded.active`,id,email,name,role,debt,credit,limit,debt?(old?.due_since||Date.now()):null,active),audit(db,actor,'member_updated',id,{before:old,after:{name,email,role,debt,credit,limit,active},reason}));
  statements.push(stmt(db,'INSERT INTO member_access(member_id,snacks,gear) VALUES(?,?,?) ON CONFLICT(member_id) DO UPDATE SET snacks=excluded.snacks,gear=excluded.gear',id,snacks,gear));
  if(snacks!==access.snacks||gear!==access.gear)statements.push(audit(db,actor,'purchasing_access_updated',id,{before:access,after:{snacks,gear}}));
  await atomic(db,statements);return{ok:true,memberId:id,created:!old,roleChanged};
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
  if(p.order_id){const items=await rows(db,'SELECT i.*,d.variant_id FROM order_items i LEFT JOIN order_item_details d ON d.item_id=i.id WHERE i.order_id=?',p.order_id);statements.push(stmt(db,"UPDATE orders SET status='void' WHERE id=?",p.order_id));for(const item of items)if(!item.preorder)statements.push(item.variant_id?stmt(db,'UPDATE product_variants SET stock=stock+? WHERE id=?',item.qty,item.variant_id):stmt(db,'UPDATE products SET stock=stock+? WHERE id=?',item.qty,item.product_id))}
  statements.push(audit(db,actor,'payment_rejected',p.id,{reason,returned:!!b.returned}));await atomic(db,statements);return{ok:true};
 }
 if(b.action==='expense'||b.action==='cashcount'){
  const description=str(b.description,200),amount=int(b.amount,0,10000000);if(!description)fail('Enter a description or counter names.');
  const statements=[audit(db,actor,b.action,'fund',{amount,description})];if(b.action==='expense')statements.push(stmt(db,'INSERT INTO expenses(id,kind,amount,description,created_at) VALUES(?,?,?,?,?)',uid(),'morale',amount,description,Date.now()));await atomic(db,statements);return{ok:true};
 }
 fail('Unknown action.');
}

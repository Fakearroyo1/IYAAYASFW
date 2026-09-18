import {type DB,type Row,fail,str,int,first,rows,stmt,guard,audit} from './core';
import {accessFor,canShop} from './access';
import {operation,noteText} from './operation';
import {purchased,PURCHASE_CHECK} from './community';
export const INITIATIVE_ADMIN_ACTIONS=['initiativeCreate','initiativeOpen','initiativeDecide','initiativePreorder','initiativeLoss','initiativeSchedule'];
async function shopGuard(db:DB,m:Row,category:string){if(!canShop(m as any,await accessFor(db,m as any),category))fail('This shop is not available for your account.',403)}
const baseSQL=`SELECT i.*,p.name,p.category,p.detail,p.image,p.price,p.tax_bp,p.active,p.stock,p.version product_version,COALESCE(d.archived,0) archived FROM product_initiatives i JOIN products p ON p.id=i.product_id LEFT JOIN product_details d ON d.product_id=p.id`;
export async function initiativeMetrics(db:DB,i:Row){
 const start=i.starts_at||i.created_at,end=i.state==='open'?Date.now():i.updated_at;
 const sales=await first(db,`SELECT COALESCE(SUM(b.remaining_qty),0) units,COUNT(DISTINCT CASE WHEN o.member_id IS NOT NULL THEN o.member_id END) buyers,COALESCE(SUM(b.remaining_qty*b.price),0) revenue,COALESCE(SUM(CASE WHEN b.cost IS NOT NULL THEN b.remaining_qty*b.cost ELSE 0 END),0) known_cost,COALESCE(SUM(CASE WHEN b.cost IS NULL THEN b.remaining_qty ELSE 0 END),0) unknown_cost_units,COALESCE(SUM(b.remaining_tax),0) tax FROM item_balances b JOIN orders o ON o.id=b.order_id WHERE b.product_id=? AND o.status IN('paid','tab') AND b.remaining_qty>0 AND o.created_at>=? AND o.created_at<=?`,i.product_id,start,end);
 const feedback=await first(db,"SELECT COUNT(*) count,COALESCE(SUM(f.keep),0) keep FROM trial_feedback f WHERE f.initiative_id=? AND EXISTS(SELECT 1 FROM item_balances b JOIN orders o ON o.id=b.order_id WHERE o.member_id=f.member_id AND b.product_id=? AND b.remaining_qty>0 AND o.status IN('paid','tab'))",i.id,i.product_id);
 const reviews=await first(db,'SELECT COUNT(*) count,AVG(rating) average FROM product_reviews WHERE product_id=? AND removed=0 AND '+PURCHASE_CHECK,i.product_id);
 const losses=await first(db,'SELECT COALESCE(SUM(qty),0) units,COALESCE(SUM(qty*unit_cost),0) known_cost,COALESCE(SUM(CASE WHEN unit_cost IS NULL THEN qty ELSE 0 END),0) unknown_cost_units FROM initiative_losses WHERE initiative_id=?',i.id);
 const restock=await first(db,'SELECT COALESCE(SUM(qty),0) units FROM restock_entries WHERE product_id=? AND created_at>=? AND created_at<=?',i.product_id,start,end);
 const demand=await rows(db,'SELECT option_id,option_label,SUM(qty) quantity,COUNT(*) members FROM initiative_interest WHERE initiative_id=? GROUP BY option_id,option_label ORDER BY option_label',i.id);
 const interested=await first(db,'SELECT COUNT(DISTINCT member_id) members,COALESCE(SUM(qty),0) quantity FROM initiative_interest WHERE initiative_id=?',i.id);
 return {sales,feedback,reviews,losses,restock,demand,interested,openingQuantity:i.opening_qty,receivedQuantity:restock!.units};
}
export async function initiativePage(db:DB,m:Row,q:Row,admin=false){
 const shop=q.shop||'snacks';if(!['snacks','gear'].includes(shop))fail('Choose a shop.');
 await shopGuard(db,m,shop==='gear'?'Gear':'Snacks');
 if(admin&&m.role!=='admin')fail('Administrator access is required.',403);
 const pageSize=admin?3:6,offset=int(Number(q.offset||0),0,100000),records=await rows(db,`${baseSQL} WHERE ${shop==='gear'?"p.category='Gear'":"p.category<>'Gear'"} ${admin?'':"AND i.state<>'draft' AND EXISTS(SELECT 1 FROM item_requests r WHERE r.id=i.request_id AND r.removed=0)"} ORDER BY i.created_at DESC,i.id DESC LIMIT ${pageSize+1} OFFSET ?`,offset);
 const found:Row[]=[];
 for(const i of records.slice(0,pageSize)){
  const options=await rows(db,'SELECT id,label,size,color FROM product_variants WHERE product_id=? AND active=1 ORDER BY label,id',i.product_id);
  const interest=await rows(db,'SELECT option_id,qty FROM initiative_interest WHERE initiative_id=? AND member_id=?',i.id,m.id);
  const totals=await first(db,'SELECT COUNT(DISTINCT member_id) members,COALESCE(SUM(qty),0) quantity FROM initiative_interest WHERE initiative_id=?',i.id);
  const feedback=await first(db,'SELECT keep FROM trial_feedback WHERE initiative_id=? AND member_id=?',i.id,m.id);
  const hasProduct=i.active&&!i.archived;
  const common={id:i.id,request_id:i.request_id,product_id:hasProduct||admin?i.product_id:null,name:i.name,detail:i.detail,image:i.image,kind:i.kind,state:i.state,note:i.note,ends_at:i.ends_at,starts_at:i.starts_at,version:i.version,options,interest,totals,feedback,canFeedback:i.kind==='trial'&&i.state==='open'&&i.ends_at>Date.now()&&!!m.posting_enabled&&await purchased(db,m.id,i.product_id)};
  found.push(admin?{...common,product_id:i.product_id,productActive:hasProduct,metrics:await initiativeMetrics(db,i)}:common);
 }
 return {records:found,nextOffset:records.length>pageSize?offset+pageSize:null};
}
export async function mutateInitiative(db:DB,m:Row,b:Row,tokenHash?:string){
 const action=str(b.action,40),admin=INITIATIVE_ADMIN_ACTIONS.includes(action),op=await operation(db,m,b,admin,tokenHash),now=Date.now();
 if(op.replayed)return {ok:true,replayed:true};
 if(action==='initiativeCreate'){
  const r=await first(db,'SELECT * FROM item_requests WHERE id=? AND removed=0',str(b.requestIdSource,80));
  if(!r)fail('Choose an available item request.',404);
  if(r.status==='denied')fail('Reopen the request before considering a product trial.');
  const kind=str(b.kind,20);if(!['trial','interest'].includes(kind)||kind==='interest'&&r.shop!=='gear')fail('Interest checks are for gear. Choose a snack trial or gear interest check.');
  const end=int(b.endsAt,now+3600000,now+180*86400000),note=noteText(b.note),category=r.shop==='gear'?'Gear':str(b.category||'Snacks',20);
  if(!['Gear','Drinks','Snacks','Frozen'].includes(category)||r.shop==='snacks'&&category==='Gear')fail('Choose the correct product category.');
  const productId='initiative-'+op.id;
  await op.commit([guard(db,'EXISTS(SELECT 1 FROM item_requests WHERE id=? AND version=? AND removed=0)',r.id,int(b.version)),
   stmt(db,'INSERT INTO products(id,name,category,detail,active,preorder,stock,position) VALUES(?,?,?,?,0,0,0,99)',productId,r.title,category,r.body.slice(0,160)),
   stmt(db,'INSERT INTO product_details(product_id,description) VALUES(?,?)',productId,r.body),
   stmt(db,"INSERT INTO product_initiatives(id,request_id,product_id,kind,state,note,ends_at,actor,created_at,updated_at) VALUES(?,?,?,?,'draft',?,?,?,?,?)",op.id,r.id,productId,kind,note,end,m.id,now,now),
   stmt(db,"UPDATE item_requests SET status='accepted',decision_note=?,version=version+1,updated_at=? WHERE id=?",note,now,r.id),audit(db,m.id,'initiative_created',op.id,{requestId:r.id,productId,kind,note})
  ]);return {ok:true,id:op.id,productId};
 }
 const i=await first(db,`${baseSQL} WHERE i.id=?`,str(b.id,80));if(!i)fail('Initiative unavailable.',404);
 await shopGuard(db,m,i.category);
 const g=guard(db,'EXISTS(SELECT 1 FROM product_initiatives WHERE id=? AND version=? AND state=?)',i.id,int(b.version),i.state);
 const visible=guard(db,'EXISTS(SELECT 1 FROM item_requests WHERE id=? AND removed=0)',i.request_id);
 const access=guard(db,"EXISTS(SELECT 1 FROM members m LEFT JOIN member_access a ON a.member_id=m.id LEFT JOIN member_controls c ON c.member_id=m.id WHERE m.id=? AND m.active=1 AND COALESCE(c.posting_enabled,1)=1 AND(m.role='admin' OR CASE WHEN ?='Gear' THEN COALESCE(a.gear,1) ELSE COALESCE(a.snacks,1) END=1))",m.id,i.category);
 if(!admin&&(!m.posting_enabled||i.state!=='open'||i.ends_at<=now))fail('This activity is closed or posting is unavailable.',403);
 if(action==='interestSave'){
  if(i.kind!=='interest')fail('Choose an interest check.');
  const optionId=str(b.optionId||'',80),qty=int(b.qty,0,20),options=await rows(db,'SELECT id,label FROM product_variants WHERE product_id=? AND active=1',i.product_id),option=options.find(v=>v.id===optionId);
  if((options.length&&!option)||(!options.length&&optionId))fail('Choose an available option.');
  const change=qty?stmt(db,'INSERT INTO initiative_interest(initiative_id,member_id,option_id,option_label,qty,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(initiative_id,member_id,option_id) DO UPDATE SET option_label=excluded.option_label,qty=excluded.qty,updated_at=excluded.updated_at',i.id,m.id,optionId,option?.label||'Standard',qty,now):stmt(db,'DELETE FROM initiative_interest WHERE initiative_id=? AND member_id=? AND option_id=?',i.id,m.id,optionId);
  await op.commit([g,visible,access,guard(db,'EXISTS(SELECT 1 FROM product_initiatives WHERE id=? AND ends_at>?)',i.id,now),guard(db,'EXISTS(SELECT 1 FROM products WHERE id=? AND version=?)',i.product_id,i.product_version),change]);return {ok:true};
 }
 if(action==='trialFeedback'){
  if(i.kind!=='trial'||!await purchased(db,m.id,i.product_id))fail('A recorded purchase is required for trial feedback.',403);
  const keep=int(b.keep,0,1);
  await op.commit([g,visible,access,guard(db,'EXISTS(SELECT 1 FROM product_initiatives WHERE id=? AND ends_at>?)',i.id,now),guard(db,"EXISTS(SELECT 1 FROM item_balances b JOIN orders o ON o.id=b.order_id WHERE o.member_id=? AND b.product_id=? AND b.remaining_qty>0 AND o.status IN('paid','tab'))",m.id,i.product_id),stmt(db,'INSERT INTO trial_feedback(initiative_id,member_id,keep,updated_at) VALUES(?,?,?,?) ON CONFLICT(initiative_id,member_id) DO UPDATE SET keep=excluded.keep,updated_at=excluded.updated_at',i.id,m.id,keep,now)]);return {ok:true};
 }
 if(action==='initiativeSchedule'){
  if(!['draft','open'].includes(i.state))fail('Only an active or draft activity can be rescheduled.');
  const end=int(b.endsAt,now+3600000,now+180*86400000),note=noteText(b.note);
  await op.commit([g,stmt(db,'UPDATE product_initiatives SET ends_at=?,version=version+1,updated_at=? WHERE id=?',end,now,i.id),audit(db,m.id,'initiative_rescheduled',i.id,{endsAt:end,note})]);return {ok:true};
 }
 if(action==='initiativeOpen'){
  if(i.state!=='draft'||i.ends_at<=now)fail('Choose a draft with a future review date.');
  if(i.archived)fail('Restore the product before starting.');
  const ready="EXISTS(SELECT 1 FROM products p WHERE p.id=? AND p.active=1 AND p.tax_bp IS NOT NULL AND ((NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id) AND p.price>0) OR (EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active=1) AND NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active=1 AND COALESCE(v.price,p.price,0)<=0))))";
  if(i.kind==='trial'&&!await first(db,'SELECT 1 WHERE '+ready,i.product_id))fail('Configure and publish this product before starting its trial.');
  await op.commit([g,guard(db,'EXISTS(SELECT 1 FROM products WHERE id=? AND version=?)',i.product_id,i.product_version),...(i.kind==='trial'?[guard(db,ready,i.product_id)]:[]),stmt(db,"UPDATE product_initiatives SET state='open',starts_at=?,opening_qty=(SELECT stock FROM products WHERE id=product_initiatives.product_id)+COALESCE((SELECT SUM(stock) FROM product_variants WHERE product_id=product_initiatives.product_id AND active=1),0),version=version+1,updated_at=? WHERE id=?",now,now,i.id),audit(db,m.id,'initiative_opened',i.id,{startedAt:now})]);return {ok:true};
 }
 if(action==='initiativeDecide'){
  if(!['draft','open'].includes(i.state))fail('This activity is already complete.',409);
  const state=str(b.state,20),note=noteText(b.note);
  if(state==='kept'&&i.state!=='open')fail('Start the trial before keeping this product.');
  if(i.kind==='trial'?!['kept','discontinued'].includes(state):state!=='closed')fail('Choose a valid outcome.');
  await op.commit([g,...(state==='discontinued'?[stmt(db,'UPDATE products SET active=0,version=version+1 WHERE id=?',i.product_id)]:[]),stmt(db,'UPDATE product_initiatives SET state=?,note=?,version=version+1,updated_at=? WHERE id=?',state,note,now,i.id),audit(db,m.id,'initiative_decided',i.id,{state,note})]);return {ok:true};
 }
 if(action==='initiativePreorder'){
  if(i.kind!=='interest'||i.state!=='open')fail('Choose an open gear interest check.');
  const note=noteText(b.note);
  const ready="EXISTS(SELECT 1 FROM products p LEFT JOIN product_details d ON d.product_id=p.id WHERE p.id=? AND p.active=1 AND COALESCE(d.archived,0)=0 AND p.tax_bp IS NOT NULL AND ((NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id) AND p.price>0 AND p.preorder=1) OR (EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active=1) AND NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active=1 AND (v.preorder=0 OR COALESCE(v.price,p.price,0)<=0)))))";
  if(!await first(db,'SELECT 1 WHERE '+ready,i.product_id))fail('In Gear Manager, enable preorder for each active option, set prices and tax, then publish the same product.');
  await op.commit([g,guard(db,ready,i.product_id),stmt(db,"UPDATE product_initiatives SET state='preorder',note=?,version=version+1,updated_at=? WHERE id=?",note,now,i.id),audit(db,m.id,'interest_became_preorder',i.id,{productId:i.product_id,note})]);return {ok:true};
 }
 if(action==='initiativeLoss'){
  if(i.kind!=='trial'||i.state!=='open')fail('Choose an active trial.');
  const optionId=str(b.optionId||'',80),v=optionId?await first(db,'SELECT * FROM product_variants WHERE id=? AND product_id=?',optionId,i.product_id):null;
  if(optionId&&!v)fail('Choose a valid product option.');
  const product=await first(db,'SELECT * FROM products WHERE id=?',i.product_id),qty=int(b.qty,1,100000),kind=str(b.kind,10),note=noteText(b.note),current=v||product!;
  if(!['waste','shrink'].includes(kind)||qty>current.stock)fail('Enter a valid quantity no greater than current stock.');
  const table=v?'product_variants':'products',cost=v?.cost??product!.cost;
  await op.commit([g,guard(db,`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND stock=? AND version=?)`,current.id,current.stock,current.version),stmt(db,`UPDATE ${table} SET stock=stock-?,version=version+1 WHERE id=?`,qty,current.id),...(v?[stmt(db,'UPDATE products SET version=version+1 WHERE id=?',i.product_id)]:[]),stmt(db,'INSERT INTO initiative_losses(id,initiative_id,variant_id,qty,unit_cost,kind,note,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?)',op.id,i.id,optionId||null,qty,cost,kind,note,m.id,now),audit(db,m.id,'trial_stock_loss',i.product_id,{initiativeId:i.id,variantId:optionId,qty,kind,note,cost})]);return {ok:true};
 }
 fail('Choose a supported product activity.');
}

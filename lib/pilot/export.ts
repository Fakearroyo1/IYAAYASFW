type Row=Record<string,any>;
const dollars=(v:number|null)=>v==null?'':v/100;
const utc=(v:number|null)=>v?new Date(v).toISOString():'';
export function exportRows(data:Row,kind:string,from='',to=''):Row[]{
 const a=data.admin,member=(id:string)=>a.members.find((m:Row)=>m.id===id);
 const start=from?Date.parse(from+'T00:00:00Z'):-Infinity,end=to?Date.parse(to+'T00:00:00Z')+86400000:Infinity;
 const included=(r:Row)=>r.created_at>=start&&r.created_at<end;
 const snapshot=new Date().toISOString();
 if(kind==='purchases')return a.orders.filter(included).map((o:Row)=>({'Purchase ID':o.id,Reference:o.code,'Created UTC':utc(o.created_at),Payer:o.payer,'Member email':member(o.member_id)?.email||'',Method:o.method,Status:o.status,'Total USD':dollars(o.total),'Included tax USD':dollars(o.tax),'Item cost USD':dollars(o.cost)}));
 if(kind==='items')return a.items.flatMap((i:Row)=>{const o=a.orders.find((o:Row)=>o.id===i.order_id);return o&&included(o)?[{'Purchase ID':o.id,Reference:o.code,'Created UTC':utc(o.created_at),Payer:o.payer,Status:o.status,'Product ID':i.product_id,Product:i.name,Quantity:i.qty,'Size / color':i.variant_label||'',Personalization:i.personalization||'','Pickup status':i.fulfillment||'untracked','Unit price USD':dollars(i.price),'Line total USD':dollars(i.price*i.qty),'Unit cost USD':dollars(i.cost),'Tax rate percent':i.tax_bp/100,Preorder:!!i.preorder}]:[]});
 if(kind==='payments')return a.payments.filter(included).map((p:Row)=>({'Payment ID':p.id,'Purchase ID':p.order_id||'','Purchase reference':p.order_code||'','Created UTC':utc(p.created_at),Member:p.member_name||p.payer||'Guest','Member email':member(p.member_id)?.email||'',Purpose:p.purpose,Method:p.method,Status:p.status,'Amount USD':dollars(p.amount),'Payment reference':p.reference||'','Verified UTC':utc(p.verified_at),'Verified by':member(p.verified_by)?.name||p.verified_by||''}));
 if(kind==='expenses')return a.expenses.filter(included).map((e:Row)=>({'Expense ID':e.id,'Created UTC':utc(e.created_at),Type:e.kind,'Amount USD':dollars(e.amount),Description:e.description}));
 if(kind==='members')return a.members.map((m:Row)=>({'Exported UTC':snapshot,'Member ID':m.id,Name:m.name,Email:m.email,Role:m.role,'Snack bar access':m.role==='admin'||!!m.snacks,'Gear access':m.role==='admin'||!!m.gear,Active:!!m.active,'Signed in':!!m.user_id,'Tab USD':dollars(m.debt),'Credit USD':dollars(m.credit),'Tab limit USD':dollars(m.tab_limit),'Unpaid since UTC':utc(m.due_since)}));
 if(kind==='inventory')return data.products.map((p:Row)=>({'Exported UTC':snapshot,'Product ID':p.id,Name:p.name,Category:p.category,'Variety / size':p.detail,'Price USD':dollars(p.price),'Cost USD':dollars(p.cost),'Tax rate percent':p.tax_bp==null?'':p.tax_bp/100,'On hand':p.stock,'Restock at':p.reorder,Active:!!p.active,Archived:!!p.archived,Preorder:!!p.preorder}));
 if(kind==='options')return data.products.flatMap((p:Row)=>(p.variants||[]).map((v:Row)=>({'Exported UTC':snapshot,'Product ID':p.id,Product:p.name,'Option ID':v.id,Option:v.label,Size:v.size,Color:v.color,'Effective price USD':dollars(v.price??p.price),'Effective cost USD':dollars(v.cost??p.cost),Stock:v.stock,Active:!!v.active,Preorder:!!v.preorder})));
 if(kind==='audit')return a.events.filter(included).map((e:Row)=>({'Event ID':e.id,'Created UTC':utc(e.created_at),Actor:member(e.actor)?.name||e.actor,Action:e.kind,Target:e.target,Details:e.detail}));
 throw Error('Choose a record type.');
}
export function toCsv(rows:Row[]){
 const cell=(value:any)=>{let text=String(value??'');if(typeof value==='string'&&/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"'};
 if(!rows.length)return '"Result"\r\n"No records in the selected period"\r\n';
 const keys=Object.keys(rows[0]);return [keys.map(cell).join(','),...rows.map(row=>keys.map(k=>cell(row[k])).join(','))].join('\r\n')+'\r\n';
}

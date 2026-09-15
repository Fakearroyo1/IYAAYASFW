import {env} from 'cloudflare:workers';
import {getUser} from '@/app/auth';
import {requireAdminAccess} from '@/lib/security/admin-access';
import {rateLimit,sessionUser} from '@/lib/auth/session';
import {RequestError} from '@/lib/security/http';
import {PilotError,identity} from '@/lib/pilot/service';
import {dateRange,historyPage} from '@/lib/pilot/history';
import {rows} from '@/lib/pilot/core';
import {catalogState} from '@/lib/pilot/products';
import {accessFor} from '@/lib/pilot/access';
import {exportRows,toCsv} from '@/lib/pilot/export';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 if(!env.DB)throw new RequestError('The shared store is temporarily unavailable.',503);const db=env.DB;
 const user=await getUser();if(!user)throw new RequestError('Sign in to export records.',401);await requireAdminAccess(db,user);
 if(!await rateLimit(db,'export:'+user.memberId,3,900000))throw new RequestError('Export limit reached. Try again in 15 minutes.',429);
 const member=await identity(db,user);if(!member)throw new RequestError('Administrator access is required.',403);
 const q=new URL(request.url).searchParams,kind=q.get('dataset')||'',from=q.get('from')||'',to=q.get('to')||'';dateRange(from,to);
 const kinds:Record<string,string>={purchases:'orders',items:'items',payments:'payments',expenses:'expenses',members:'members',inventory:'inventory',options:'inventory',audit:'events'};
 if(!Object.hasOwn(kinds,kind))throw new RequestError('Choose a record type.',400);
 const until=Date.now()+1,encoder=new TextEncoder();let cursor:string|undefined,started=false,finished=false;
 const stream=new ReadableStream<Uint8Array>({async pull(controller){try{
  const current=await sessionUser(db,request.headers.get('cookie'));if(!current)throw Error('Session expired');await requireAdminAccess(db,current);
  const data:any={products:[],admin:{orders:[],items:[],payments:[],expenses:[],members:[],events:[]}};
  if(kinds[kind]==='inventory'){data.products=await catalogState(db,member,await accessFor(db,member as any));finished=true}
  else{
   const page=await historyPage(db,member,kinds[kind],{admin:true,limit:40,cursor,from,to,until});cursor=page.nextCursor||undefined;finished=!cursor;data.admin[kinds[kind]]=page.records;
   if(kind==='items'&&page.records.length){const ids=[...new Set(page.records.map(r=>r.order_id))];data.admin.orders=await rows(db,`SELECT * FROM orders WHERE id IN(${ids.map(()=>'?').join(',')})`,...ids)}
   if(kind!=='members'){const ids=[...new Set([...data.admin.orders,...data.admin.payments].flatMap((r:any)=>[r.member_id,r.verified_by]).concat(data.admin.events.map((r:any)=>r.actor)).filter(Boolean))];if(ids.length)data.admin.members=await rows(db,`SELECT id,name,email FROM members WHERE id IN(${ids.map(()=>'?').join(',')})`,...ids)}
  }
  const records=exportRows(data,kind,from,to);
  if(records.length){const csv=toCsv(records);controller.enqueue(encoder.encode(started?csv.slice(csv.indexOf('\r\n')+2):'\uFEFF'+csv));started=true}
  if(finished){if(!started)controller.enqueue(encoder.encode('\uFEFF'+toCsv([])));controller.close()}
 }catch(e){controller.error(e)}}});
 return new Response(stream,{headers:{'Content-Type':'text/csv;charset=utf-8','Content-Disposition':`attachment; filename="unit-supply-${kind}-${new Date().toISOString().slice(0,10)}.csv"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){return Response.json({error:e instanceof RequestError||e instanceof PilotError?e.message:'The export could not start.'},{status:e instanceof RequestError||e instanceof PilotError?e.status:503})}}

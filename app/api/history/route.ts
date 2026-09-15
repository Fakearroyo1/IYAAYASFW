import {env} from 'cloudflare:workers';
import {getUser} from '@/app/auth';
import {requireAdminAccess} from '@/lib/security/admin-access';
import {rateLimit} from '@/lib/auth/session';
import {RequestError} from '@/lib/security/http';
import {PilotError,identity} from '@/lib/pilot/service';
import {historyPage,productPerformance} from '@/lib/pilot/history';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 if(!env.DB)throw new RequestError('The shared store is temporarily unavailable.',503);const db=env.DB;
 const user=await getUser();if(!user)throw new RequestError('Sign in to view records.',401);
 const q=new URL(request.url).searchParams,admin=q.get('scope')==='admin';if(admin)await requireAdminAccess(db,user);
 if(!await rateLimit(db,'history:'+user.memberId,60,60000))throw new RequestError('Too many requests. Try again in one minute.',429);
 const member=await identity(db,user);if(!member)throw new RequestError('Member access is required.',403);
 const options={admin,cursor:q.get('cursor')||'',from:q.get('from')||'',to:q.get('to')||'',search:q.get('search')||'',filter:q.get('filter')||'',productId:q.get('productId')||''};
 const kind=q.get('dataset')||'orders';
 if(kind==='performance'){await requireAdminAccess(db,user);return Response.json(await productPerformance(db,options.productId,options))}
 return Response.json(await historyPage(db,member,kind,options));
 }catch(e){return Response.json({error:e instanceof RequestError||e instanceof PilotError?e.message:'Records could not load.'},{status:e instanceof RequestError||e instanceof PilotError?e.status:503})}}

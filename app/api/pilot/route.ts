import {readJson,RequestError} from '@/lib/security/http';
import {env} from 'cloudflare:workers';
import {getUser} from '@/app/auth';
import {renewSession,rateLimit} from '@/lib/auth/session';
import {readState,mutate,PilotError} from '@/lib/pilot/service';
export const dynamic='force-dynamic';
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function GET(request:Request){try{const user=await getUser();if(!user)return json({error:'Sign in with your approved email and password.'},401);if(!env.DB)return json({error:'The shared store is temporarily unavailable. Please try again.'},503);if(!await rateLimit(env.DB,'read:'+user.memberId,120,60000))return json({error:'Too many requests. Try again in one minute.'},429);const response=json(await readState(env.DB,user));const cookie=await renewSession(env.DB,request.headers.get('cookie'));if(cookie)response.headers.set('Set-Cookie',cookie);return response}catch(e){console.error('pilot read failed',String(e));return json({error:'The store could not load. Your records have not been changed.'},503)}}
export async function POST(request:Request){try{
 const user=await getUser();if(!user)return json({error:'Sign in with your approved email and password.'},401);
 const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin)return json({error:'Open the store and try again.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'JSON is required.'},415);
 const body=await readJson(request,24000);
 if(!env.DB)return json({error:'The shared store is temporarily unavailable. Nothing has been recorded.'},503);
 if(!await rateLimit(env.DB,'write:'+user.memberId,user.role==='admin'?90:30,60000))return json({error:'Too many changes. Try again in one minute.'},429);
 const result=await mutate(env.DB,user,body);if(user.role!=='admin'&&'order' in result&&result.order){const {cost,fingerprint,...order}=result.order;return json({...result,order})}return json(result);
 }catch(e){if(e instanceof RequestError||e instanceof PilotError)return json({error:e.message},e.status);console.error('pilot write failed',String(e));return json({error:'Could not confirm this action. Keep this page open and retry the same request.'},503)}}

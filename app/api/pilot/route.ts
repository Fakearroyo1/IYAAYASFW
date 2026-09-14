import {env} from 'cloudflare:workers';
import {getUser} from '@/app/auth';
import {renewSession} from '@/lib/auth/session';
import {readState,mutate,PilotError} from '@/lib/pilot/service';
export const dynamic='force-dynamic';
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function GET(request:Request){try{const user=await getUser();if(!user)return json({error:'Sign in with your approved email and password.'},401);if(!env.DB)return json({error:'The shared store is temporarily unavailable. Please try again.'},503);const response=json(await readState(env.DB,user));const cookie=await renewSession(env.DB,request.headers.get('cookie'));if(cookie)response.headers.set('Set-Cookie',cookie);return response}catch(e){console.error('pilot read failed',String(e));return json({error:'The store could not load. Your records have not been changed.'},503)}}
export async function POST(request:Request){try{
 const user=await getUser();if(!user)return json({error:'Sign in with your approved email and password.'},401);
 const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin)return json({error:'Open the store and try again.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'JSON is required.'},415);
 const raw=await request.text();if(raw.length>24000)return json({error:'Request is too large.'},413);let body;try{body=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Invalid request.'},400);
 if(!env.DB)return json({error:'The shared store is temporarily unavailable. Nothing has been recorded.'},503);
 return json(await mutate(env.DB,user,body));
 }catch(e){if(e instanceof PilotError)return json({error:e.message},e.status);console.error('pilot write failed',String(e));return json({error:'Could not confirm this action. Keep this page open and retry the same request.'},503)}}

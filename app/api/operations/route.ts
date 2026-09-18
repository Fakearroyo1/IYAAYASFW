import {env} from 'cloudflare:workers';
import {getUser} from '@/app/auth';
import {identity,PilotError} from '@/lib/pilot/service';
import {rateLimit} from '@/lib/auth/session';
import {adminVerified,requireAdminAccess} from '@/lib/security/admin-access';
import {readJson,RequestError} from '@/lib/security/http';
import {emailChanges,changeEmail,EMAIL_ADMIN_ACTIONS} from '@/lib/pilot/email-changes';
import {taskPage,updateTask} from '@/lib/pilot/tasks';
import {initiativePage,mutateInitiative,INITIATIVE_ADMIN_ACTIONS} from '@/lib/pilot/initiatives';
export const dynamic='force-dynamic';
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const failure=(e:unknown)=>json({error:e instanceof PilotError||e instanceof RequestError?e.message:'The update could not be confirmed. Keep this page open and retry.'},e instanceof PilotError||e instanceof RequestError?e.status:503);
export async function GET(request:Request){try{
 const u=await getUser();if(!u)throw new RequestError('Sign in to continue.',401);if(!env.DB)throw new RequestError('The store is unavailable.',503);
 if(!await rateLimit(env.DB,'operations-read:'+u.memberId,60,60000))throw new RequestError('Try again in one minute.',429);
 const q=Object.fromEntries(new URL(request.url).searchParams),m=await identity(env.DB,u);if(!m)throw new RequestError('Member access is required.',403);
 if(q.kind==='inbox'||q.kind==='emailAdmin'||q.admin==='true')await requireAdminAccess(env.DB,u);
 if(q.kind==='inbox')return json(await taskPage(env.DB,m,q));
 if(q.kind==='email'||q.kind==='emailAdmin')return json(await emailChanges(env.DB,m,q.kind==='emailAdmin',q));
 if(q.kind==='initiatives')return json(await initiativePage(env.DB,m,q,q.admin==='true'&&await adminVerified(env.DB,u)));
 throw new RequestError('Choose a supported view.',400);
 }catch(e){return failure(e)}}
export async function POST(request:Request){try{
 const u=await getUser();if(!u)throw new RequestError('Sign in to continue.',401);
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new RequestError('Open the store and try again.',403);
 const b=await readJson(request,14000);if(!env.DB)throw new RequestError('The store is unavailable.',503);
 if(!await rateLimit(env.DB,'operations-write:'+u.memberId,30,60000))throw new RequestError('Too many changes. Try again in one minute.',429);
 if(['taskUpdate','taskBulk','tabReminder',...EMAIL_ADMIN_ACTIONS,...INITIATIVE_ADMIN_ACTIONS].includes(b.action))await requireAdminAccess(env.DB,u);
 if(['emailRequest','emailVerify'].includes(b.action)&&!await rateLimit(env.DB,'email-check:'+u.memberId,5,600000))throw new RequestError('Try again in ten minutes.',429);
 const m=await identity(env.DB,u);if(!m)throw new RequestError('Member access is required.',403);
 if(['emailRequest','emailVerify','emailCancel',...EMAIL_ADMIN_ACTIONS].includes(b.action))return json(await changeEmail(env.DB,m,b,u.tokenHash));
 if(['taskUpdate','taskBulk','tabReminder'].includes(b.action))return json(await updateTask(env.DB,m,b,u.tokenHash));
 if(['interestSave','trialFeedback',...INITIATIVE_ADMIN_ACTIONS].includes(b.action))return json(await mutateInitiative(env.DB,m,b,u.tokenHash));
 throw new RequestError('Choose a supported action.',400);
 }catch(e){return failure(e)}}

import {env} from 'cloudflare:workers';
import {getUser} from '@/app/auth';
import {verifyAccessToken,grantAdminAccess} from '@/lib/security/admin-access';
import {rateLimit} from '@/lib/auth/session';
import {RequestError} from '@/lib/security/http';
export const dynamic='force-dynamic';
// Cloudflare Access protects this exact route with a dedicated MFA application.
// All administrator APIs independently require the session-bound proof it issues.
export async function GET(request:Request){
 try{
  if(!env.DB)throw new RequestError('The shared store is temporarily unavailable.',503);const db=env.DB;
 const user=await getUser();if(!user)return Response.redirect(new URL('/login',request.url),303);
  if(user.role!=='admin')throw new RequestError('Administrator access is required.',403);
  if(!await rateLimit(db,'admin-verify:'+user.memberId,10,60000))throw new RequestError('Wait one minute before verifying again.',429);
  const proof=await verifyAccessToken(request.headers.get('cf-access-jwt-assertion')||'',env as any,user.email);
  await grantAdminAccess(db,user,proof);
  return Response.redirect(new URL('/?view=admin',request.url),303);
 }catch(error){const status=error instanceof RequestError?error.status:503;return new Response('Administrator verification was not completed. Return to the store and try again. If setup is incomplete, the owner must finish Cloudflare Access configuration.',{status,headers:{'Content-Type':'text/plain;charset=utf-8','Cache-Control':'no-store'}})}
}

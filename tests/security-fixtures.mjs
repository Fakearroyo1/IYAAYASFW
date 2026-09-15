// Synthetic fixtures only. Production code has no testing bypass.
import {createHash} from 'node:crypto';
export const challengeBindings={TURNSTILE_SITE_KEY:'test-site-key',TURNSTILE_SECRET_KEY:'test-secret'};
export async function challengeService(request){
 const url=new URL(request.url);
 if(url.origin!=='https://challenges.cloudflare.com'||url.pathname!=='/turnstile/v0/siteverify')return new Response('Unexpected test outbound request',{status:502});
 const form=await request.json(),token=form.response;
 return Response.json({success:form.secret==='test-secret'&&['test-valid','wrong-host','wrong-action'].includes(token),hostname:token==='wrong-host'?'attacker.test':'test.local',action:token==='wrong-action'?'other':'account'});
}
export async function grantFixtureMfa(db,cookie){
 const token=cookie.slice(cookie.indexOf('=')+1),hash=createHash('sha256').update(token).digest('hex');
 await db.prepare('INSERT INTO auth_admin_access(token_hash,subject,verified_at,expires_at) VALUES(?,?,?,?)').bind(hash,'fixture-subject',Date.now(),Date.now()+1800000).run();
}

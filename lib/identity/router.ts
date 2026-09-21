import {readJson,RequestError} from '../security/http';
import {rateLimit,sessionCookie} from '../auth/session';
import {BROWSER,DESTINATION,ADMIN_COOKIE,config,cookie,cookieValue,csrfToken,verifyCsrf,browserHash,digest,random,same,text,method,fail,flow,sql,one,all,requireRolloutMember,freshMethods,safeReturn,type IdentitySettings,type Flow,type Credential} from './common';
import {readSession,accessPrincipal,adminSession,requireOwner,usesAdminHost,type IdentityUser,type AccessPrincipal} from './sessions';
import {newFlow,adoptFlow,boundFlow,grantFor,claimInvite,bridgeInvite,associateProvider,storeEnrollmentProof,finishEnrollment,freshPassword,authenticated,issueHandoff,redeem} from './flows';
import {startProvider,finishProvider,startPasskey,finishPasskey} from './providers';
import {ownMethods,ownMutation,adminRead,adminMutation,payloadHash} from './manage';
import {previewImport,commitImport} from './imports';
type Runtime=IdentitySettings&{DB?:D1Database};
const json=(value:unknown,status=200,cookies:string[]=[])=>{const headers=new Headers({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','Content-Type':'application/json;charset=utf-8'});for(const c of cookies)headers.append('Set-Cookie',c);return new Response(JSON.stringify(value),{status,headers});};
const redirect=(url:string,cookies:string[]=[])=>{const headers=new Headers({Location:url,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});for(const value of cookies)headers.append('Set-Cookie',value);return new Response(null,{status:303,headers});};
export function identityHost(env:IdentitySettings,url:URL){const c=config(env);return url.origin===c.member?'member':url.origin===c.auth?'auth':url.origin===c.register?'register':url.origin===c.admin?'admin':null;}
async function displayedFlow(db:D1Database,env:IdentitySettings,f:Flow){
 let target:string|null=null,proof:{kind:string;email:string|null}|null=null;
 if(f.member_id&&f.purpose==='enroll')target=(await one<{name:string}>(db,'SELECT name FROM members WHERE id=?',f.member_id))?.name||null;
 if(f.proof&&f.purpose==='enroll'){const p=JSON.parse(f.proof);proof={kind:p.kind,email:p.email||null};}
 return{id:f.id,purpose:f.purpose,status:f.status,action:f.action,target,proof,proofId:proof?digest(f.proof!):null,returnPath:f.return_path,review:f.proof==='"review"',freshMethods:f.purpose==='fresh'?await freshMethods(db,env,f):null,googleFreshUnavailable:f.purpose==='fresh'&&env.IDENTITY_GOOGLE_FRESH_ENABLED!=='true',hasPassword:f.purpose==='fresh'&&!!await one(db,'SELECT 1 FROM auth_credentials WHERE member_id=?',f.member_id)};
}
export async function identityRoute(request:Request,env:Runtime,principal?:AccessPrincipal):Promise<Response|null>{
 const url=new URL(request.url),c=config(env),host=identityHost(env,url);
 if(!c.enabled)return url.pathname==='/identity/api'&&request.method==='GET'?json({enabled:false}):url.pathname.startsWith('/identity')||url.pathname.startsWith('/oidc/')?json({error:'New sign-in methods are not enabled yet.'},404):null;
 if(!host)return json({error:'Unknown application host.'},421);
 const loginEntry=host==='member'&&url.pathname==='/login'&&request.method==='GET'&&url.searchParams.get('password')!=='1';
 if(!loginEntry&&url.pathname!=='/identity/api'&&!url.pathname.startsWith('/oidc/'))return null;
 try{
  if(!env.DB)fail('Sign-in is temporarily unavailable.',503);const db=env.DB!;
  if(loginEntry){
   const next=safeReturn(url.searchParams.get('next'));
   if(await readSession(db,request,'member'))return redirect(c.member+next);
   const ip=request.headers.get('cf-connecting-ip')||'unknown';
   if(!await rateLimit(db,'identity-start:'+ip,180,900000))fail('Too many sign-in starts. Try again later.',429);
   // A top-level login navigation may initialize an anonymous flow, but cannot
   // prove identity or authorize an account change. Bind its return to a fresh
   // host-only destination cookie before showing choices on the auth host.
   const destination=random(),flowId=await newFlow(db,digest(destination),next);
   return redirect(c.auth+'/identity?flow='+encodeURIComponent(flowId),[cookie(DESTINATION,destination)]);
  }
  if(url.pathname.startsWith('/oidc/')){
   if(host!=='auth'||request.method!=='GET')return json({error:'Not found.'},404);
   const provider=url.pathname==='/oidc/google/callback'?'google':url.pathname==='/oidc/microsoft/callback'?'microsoft':null;if(!provider)return json({error:'Not found.'},404);
   const browser=browserHash(request),result=await finishProvider(db,env,url,provider,browser),f=await boundFlow(db,result.flowId,browser,'auth');
   if(f.purpose==='enroll'){requireRolloutMember(env,f.member_id||'');await storeEnrollmentProof(db,f,result.proof);return redirect(c.register+'/identity?flow='+encodeURIComponent(f.id));}
   const linked=f.purpose==='fresh'?await one<Credential>(db,"SELECT * FROM identity_credentials WHERE issuer=? AND subject=? AND client_id=? AND status='active' AND created_at<=?",result.proof.issuer,result.proof.subject,result.proof.clientId,f.created_at):await associateProvider(db,env,result.proof,f);
   if(f.purpose==='fresh'&&!linked)fail('Use a method already linked to this member.',403);
   if(!linked){await sql(db,'UPDATE identity_flows SET proof=? WHERE id=?','"review"',f.id).run();return redirect(c.auth+'/identity?flow='+encodeURIComponent(f.id));}
   await authenticated(db,f,linked,result.proof.authTime);return redirect(await issueHandoff(db,env,f.id));
  }
  const user=host==='member'||host==='admin'?await readSession(db,request,host):null;
  if(host==='admin'&&user&&principal?.id!==user.principalId)fail('The Access account and administrator session do not match.',403);
  if(request.method==='GET'){
   let browser=cookieValue(request,BROWSER);const cookies:string[]=[];
   if(!/^[A-Za-z0-9_-]{43}$/.test(browser)){browser=random();cookies.push(cookie(BROWSER,browser,1800));}
   const administrator=user&&!!await one(db,"SELECT 1 FROM members WHERE id=? AND role='admin' AND active=1",user.memberId);
   const management=administrator?{href:(await usesAdminHost(db,env,user!.memberId)?c.admin:c.member)+'/?view=admin',identityHref:c.admin+'/?view=admin&section=identity'}:null;
   return json({enabled:true,host,origins:{member:c.member,auth:c.auth,register:c.register,admin:c.admin},methods:c.methods,management,csrf:csrfToken(request,browser),user:user?{name:user.displayName,id:user.memberId,audience:user.audience}:null,owner:!!user&&user.memberId===env.IDENTITY_OWNER_MEMBER_ID&&host==='admin'},200,cookies);
  }
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  verifyCsrf(request);const b=await readJson(request,70000),browser=browserHash(request),action=text(b.action,40);
  const ip=request.headers.get('cf-connecting-ip')||'unknown';
  if(!await rateLimit(db,'identity-api:'+ip,1200,900000))fail('Too many attempts. Try again later.',429);
  if(action==='adminLogin'){
   if(host!=='admin'||!principal)fail();const token=await adminSession(db,principal!);return json({next:'/?view=admin'+(b.section==='identity'?'&section=identity':'')},200,[cookie(ADMIN_COOKIE,token,43200)]);
  }
  if(action==='start'){
   if(host!=='member'&&host!=='admin')fail();
   let purpose: string|undefined;
   if(b.purpose){purpose=text(b.purpose,100);if(!user)fail('Sign in first.',401);requireRolloutMember(env,user.memberId);
    if(purpose==='owner'){await requireOwner(db,user,env);if(!b.payload||typeof b.payload!=='object'||Array.isArray(b.payload))fail('Choose an action.',400);purpose='owner:'+payloadHash(b.payload);}
    else if(host!=='member')fail('Manage your own methods from the member site.',403);
   }else if(user)return json({next:'/'});
   if(!await rateLimit(db,'identity-start:'+ip,180,900000))fail('Too many sign-in starts. Try again later.',429);
   const raw=random(),flowId=await newFlow(db,digest(raw),b.next,user||undefined,purpose,b.payload);
   const startHost=purpose?.startsWith('add:')?c.register:c.auth;
   return json({next:startHost+'/identity?flow='+encodeURIComponent(flowId)},200,[cookie(DESTINATION,raw)]);
  }
  if(action==='invite'){
   if(host!=='register')fail();if(!await rateLimit(db,'invite-claim:'+ip,180,900000))fail('Too many attempts. Try again later.',429);
   const flowId=await claimInvite(db,text(b.token,100),browser);return json({next:c.member+'/identity?bridge='+encodeURIComponent(flowId)});
  }
  if(action==='bridge'){
   if(host!=='member')fail();const raw=random(),flowId=await bridgeInvite(db,text(b.flow,100),digest(raw),user);return json({next:c.register+'/identity?flow='+encodeURIComponent(flowId)},200,[cookie(DESTINATION,raw)]);
  }
  if(action==='adopt'||action==='flow'){
   if(host!=='auth'&&host!=='register')fail();const f=action==='adopt'?await adoptFlow(db,text(b.flow,100),browser,host):await boundFlow(db,text(b.flow,100),browser,host);
   if(host==='register'&&f.purpose==='login')fail();return json({flow:await displayedFlow(db,env,f)});
  }
  if(action==='continueFresh'){
   if(host!=='register')fail();const f=await boundFlow(db,text(b.flow,100),browser,'register');if(f.purpose!=='fresh'||!f.action?.startsWith('add:'))fail();return json({next:c.auth+'/identity?flow='+encodeURIComponent(f.id)});
  }
  if(action==='provider'){
   if(host!=='auth')fail();const f=await boundFlow(db,text(b.flow,100),browser,'auth'),provider=method(b.method);if(provider==='passkey')fail();
   if(f.purpose==='enroll')await grantFor(db,f);return json({next:await startProvider(db,env,f,provider,browser)});
  }
  if(action==='enrollProvider'){
   if(host!=='register')fail();const f=await boundFlow(db,text(b.flow,100),browser,'register');await grantFor(db,f);
   const chosen=method(b.method);if(chosen==='passkey')fail();return json({next:c.auth+'/identity?flow='+encodeURIComponent(f.id)+'&method='+chosen});
  }
  if(action==='passkeyOptions'||action==='passkeyVerify'){
   const registration=host==='register';if(host!=='auth'&&!registration)fail();
   const f=await boundFlow(db,text(b.flow,100),browser,registration?'register':'auth');if(registration){const g=await grantFor(db,f);if(g.provider&&g.provider!=='passkey')fail();}else if(f.purpose==='enroll')fail();
   if(!await rateLimit(db,'passkey:'+f.id,12,600000))fail('Start this sign-in again.',429);
   if(action==='passkeyOptions')return json(await startPasskey(db,env,f,browser,registration));
   const result=await finishPasskey(db,env,f,text(b.ceremony,100),browser,b.response,registration);
   if(registration){requireRolloutMember(env,f.member_id||'');await storeEnrollmentProof(db,f,result.proof!);return json({reload:true});}
   await authenticated(db,f,result.credential!);return json({next:await issueHandoff(db,env,f.id)});
  }
  if(action==='passwordProof'){
   if(host!=='auth')fail();const f=await boundFlow(db,text(b.flow,100),browser,'auth');if(typeof b.password!=='string'||b.password.length>128)fail('Enter your existing password.',400);await freshPassword(db,f,b.password);return json({next:await issueHandoff(db,env,f.id)});
  }
  if(action==='finishEnrollment'){
   if(host!=='register')fail();const f=await boundFlow(db,text(b.flow,100),browser,'register');if(!f.proof||!c.methods[method(JSON.parse(f.proof).kind)])fail('This method is temporarily disabled.',503);
   if(!same(text(b.proofId,64),digest(f.proof)))fail('The selected method changed. Review this addition again.',409);
   requireRolloutMember(env,f.member_id||'');await finishEnrollment(db,f,text(b.label||'',80));return json({next:await issueHandoff(db,env,f.id)});
  }
  if(action==='complete'){
   if(host!=='member'&&host!=='admin')fail();const raw=cookieValue(request,DESTINATION);if(!raw)fail('Return to the browser where sign-in started.',403);
   const result=await redeem(db,env,text(b.flow,100),text(b.code,100),digest(raw),host,user);
   return json({next:result.next},200,[result.keepDestination?cookie(DESTINATION,raw,300):cookie(DESTINATION,'',0),...(result.token?[sessionCookie(result.token)]:[])]);
  }
  if(!user)fail('Sign in first.',401);
  if(action==='account')return json(await ownMethods(db,user!));
  if(action==='own')return json(await ownMutation(db,env,user!,b));
  if(action==='approval'){
   const row=await one<{purpose:string;action_payload:string|null}>(db,"SELECT g.purpose,f.action_payload FROM identity_grants g JOIN identity_flows f ON f.id=g.flow_id WHERE g.id=? AND g.member_id=? AND g.source_session=? AND g.status='pending' AND g.expires_at>?",text(b.approval,80),user!.memberId,user!.tokenHash,Date.now());if(!row)fail('Approval expired. Start again.',409);return json({purpose:row!.purpose,payload:row!.action_payload?JSON.parse(row!.action_payload):null});
  }
  if(action==='adminRead')return json(await adminRead(db,env,user!,text(b.query||'',100),b.target?text(b.target,80):undefined));
  if(action==='importTemplate'){
   await requireOwner(db,user,env);
   const members=await all<{id:string}>(db,'SELECT id FROM members ORDER BY name,id LIMIT 101');
   if(members.length>100)fail('Prepare separate CSV batches of at most 100 existing member IDs.',400);
   const cell=(value:string)=>'"'+value.replace(/"/g,'""')+'"';
   return json({csv:'member_id,display_name,contact_email,google_bootstrap_email,microsoft_bootstrap_email,access_enabled\n'+members.map(m=>cell(m.id)+',,,,,').join('\n')});
  }
  if(action==='importPreview')return json(await previewImport(db,env,user!,text(b.csv,65536)));
  if(action==='admin'){
   if(!b.payload||typeof b.payload!=='object'||Array.isArray(b.payload))fail('Choose an action.',400);
   return json(b.payload.operation==='importCommit'?await commitImport(db,env,user!,b.payload,text(b.approval,80)):await adminMutation(db,env,user!,b.payload,text(b.approval,80)));
  }
  fail('Unknown identity action.',400);
 }catch(error){
  // Never log provider URLs, codes, tokens, assertions or raw library errors.
  const status=error instanceof RequestError?error.status:503;
  const message=error instanceof RequestError?error.message:'Sign-in could not be completed. Start again or use an existing method.';
  if(url.pathname.startsWith('/oidc/'))return redirect(c.auth+'/identity?error='+encodeURIComponent(message));
  return json({error:message},status);
 }
}

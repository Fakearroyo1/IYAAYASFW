// Actual compiled Worker + isolated D1. All providers/MFA here are synthetic.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {scryptSync,createHash,randomBytes} from 'node:crypto';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
const require=createRequire(import.meta.url),{Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));
const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'synthetic-access',alg:'RS256',use:'sig'};
const issuer='https://fixture.cloudflareaccess.com',audience='fixture-admin-audience',domain='test.local';
const token=async(subject='owner-subject',iat=Math.floor(Date.now()/1000),aud=audience)=>new SignJWT({email:'irrelevant@example.test'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience(aud).setSubject(subject).setIssuedAt(iat).setExpirationTime(iat+1800).sign(privateKey);
const settings={IDENTITY_ENABLED:'true',IDENTITY_ROLLOUT:'all-approved',IDENTITY_BASE_DOMAIN:domain,IDENTITY_OWNER_MEMBER_ID:'owner',IDENTITY_PASSKEY_ENABLED:'true',IDENTITY_GOOGLE_ENABLED:'false',IDENTITY_MICROSOFT_ENABLED:'false',ADMIN_ACCESS_TEAM_DOMAIN:issuer,IDENTITY_ADMIN_ACCESS_AUD:audience,TURNSTILE_SITE_KEY:'fixture-site',TURNSTILE_SECRET_KEY:'fixture-secret',OWNER_EMAIL:'owner@example.test'};
let unexpectedOutbound=0;
const mf=new Miniflare({modules:[{type:'ESModule',path:resolve('dist/server/index.js')},...readdirSync('dist/server',{recursive:true}).filter(p=>p.endsWith('.js')&&p!=='index.js').map(p=>({type:'ESModule',path:resolve('dist/server',p)}))],modulesRoot:resolve('dist/server'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:settings,cf:false,outboundService:async request=>{
 const url=new URL(request.url);if(url.href===issuer+'/cdn-cgi/access/certs')return Response.json({keys:[jwk]});
 if(url.href==='https://challenges.cloudflare.com/turnstile/v0/siteverify'){const b=await request.json();return Response.json({success:b.secret==='fixture-secret'&&b.response==='synthetic-challenge',hostname:domain,action:'account'});}
 unexpectedOutbound++;return new Response('Unexpected synthetic outbound',{status:502});
}});
let checks=0;const check=(value,label)=>{assert.ok(value,label);checks++;};
const request=(host,path='/identity/api',body,headers={})=>mf.dispatchFetch('https://'+host+path,{redirect:'manual',method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',Origin:'https://'+host}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
const browser=host=>({host,cookies:new Map(),csrf:'',access:null});
const saveCookies=(b,r)=>{for(const item of r.headers.getSetCookie()){const [name,...value]=item.split(';')[0].split('=');b.cookies.set(name,value.join('='));}};
const headers=b=>({Cookie:[...b.cookies].map(([k,v])=>k+'='+v).join('; '),...(b.access?{'cf-access-jwt-assertion':b.access}:{})});
async function context(b){const r=await request(b.host,'/identity/api',undefined,headers(b));saveCookies(b,r);const c=await r.json();if(r.status===200)b.csrf=c.csrf;return {r,c};}
async function post(b,body,extra={}){const r=await request(b.host,'/identity/api',body,{...headers(b),'x-identity-csrf':b.csrf,...extra});saveCookies(b,r);return r;}
const digest=v=>createHash('sha256').update(v).digest('hex');
try{
 const db=await mf.getD1Database('DB');
 for(const file of [...readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort().map(x=>'drizzle/'+x),...['AUTH','PRODUCT','SECURITY','BETA','ROUNDS','GUEST','AUTOPILOT','REWARDS','EARNING','REDEMPTION','PROFILE-EXPERIENCE','ADMIN-EXPERIENCE','IDENTITY'].map(x=>x+'-SCHEMA.sql')])await db.exec(readFileSync(file,'utf8').replace(/--> statement-breakpoint/g,'').replace(/^--.*$/gm,'').replace(/\n/g,' '));
 const password='Synthetic worker password 13579',salt='12345678901234567890123456789012',hash='scrypt$16384$8$5$'+salt+'$'+scryptSync(password,salt,32,{N:16384,r:8,p:5,maxmem:32*1024*1024}).toString('hex');
 await db.prepare("INSERT INTO members(id,email,name,role,debt,credit) VALUES('owner','owner@example.test','Owner','admin',0,0),('second-admin','second@example.test','Second admin','admin',0,0),('member','member@example.test','Member','member',725,250)").run();
 await db.prepare("INSERT INTO settings(id) VALUES('main')").run();
 for(const id of ['owner','second-admin','member'])await db.prepare('INSERT INTO auth_credentials VALUES(?,?,?)').bind(id,hash,Date.now()).run();
 for(const [id,sub,isOwner] of [['owner','owner-subject',1],['second-admin','second-subject',0]])await db.prepare('INSERT INTO identity_admin_principals(id,issuer,subject,member_id,identity_owner,provisioned_at,evidence) VALUES(?,?,?,?,?,?,?)').bind('p-'+id,issuer,sub,id,isOwner,Date.now(),'synthetic signed fixture').run();
 check((await request('unknown.test')).status===421,'unknown host denied');
 for(const host of ['auth.test.local','register.test.local'])for(const path of ['/api/pilot','/api/auth','/api/export','/api/history','/api/transactions','/api/community','/api/operations','/api/roadmap','/api/profile-images','/api/product-images','/api/admin/access'])check([404,405].includes((await request(host,path)).status),'legacy API isolated: '+host+path);
 const member=browser(domain);const ctx=await context(member);check(ctx.r.status===200&&ctx.c.methods.passkey,'identity context is available');
 const cookie=ctx.r.headers.get('set-cookie');check(cookie.includes('Secure')&&cookie.includes('HttpOnly')&&cookie.includes('SameSite=Lax')&&!/;\s*Domain=/i.test(cookie),'identity cookie is secure and host-only');
 check((await post(member,{action:'start'},{Origin:'https://evil.test'})).status===403,'cross-origin mutation rejected');
 check((await post(member,{action:'start'},{'x-identity-csrf':'wrong'})).status===403,'wrong CSRF rejected');
 check((await request(domain,'/api/auth',{action:'login',email:'member@example.test',password,challengeToken:'synthetic-challenge'})).status===403,'legacy mutation also requires identity CSRF');
 const login=await request(domain,'/api/auth',{action:'login',email:'member@example.test',password,challengeToken:'synthetic-challenge'},{...headers(member),'x-identity-csrf':member.csrf});saveCookies(member,login);check(login.status===200,'legacy password remains usable');await context(member);
 const own=await post(member,{action:'account'});check(own.status===200&&(await own.json()).hasPassword,'existing account preserved');
 const flowResponse=await post(member,{action:'start',purpose:'add:passkey',next:'//evil.test'}),flowResult=await flowResponse.json();check(flowResponse.status===200&&flowResult.next.startsWith('https://register.test.local/identity?flow='),'fresh addition begins at fixed registration host');
 const flowId=new URL(flowResult.next).searchParams.get('flow'),register=browser('register.test.local'),auth=browser('auth.test.local');await context(register);await context(auth);
 check((await post(register,{action:'adopt',flow:flowId})).status===200,'registration browser binds before proof');
 check((await post(register,{action:'continueFresh',flow:flowId})).status===200,'fresh proof sends browser to auth');
 check((await post(auth,{action:'adopt',flow:flowId})).status===200,'auth browser binds');
 const other=browser('auth.test.local');await context(other);check((await post(other,{action:'adopt',flow:flowId})).status===403,'another auth browser cannot adopt flow');
 const proof=await post(auth,{action:'passwordProof',flow:flowId,password}),proofBody=await proof.json();check(proof.status===200,'fresh existing password accepted');
 const fragment=new URLSearchParams(new URL(proofBody.next).hash.slice(1));
 const completion=await post(member,{action:'complete',flow:flowId,code:fragment.get('code')}),completed=await completion.json();check(completion.status===200&&completed.next.startsWith('https://register.test.local/identity?flow='),'fresh grant hands off to registration');
 check(completion.headers.getSetCookie().some(c=>c.startsWith('__Host-identity-destination=')&&!c.includes('Max-Age=0')),'destination binding retained through enrollment');
 const nextFlow=new URL(completed.next).searchParams.get('flow');check((await post(register,{action:'adopt',flow:nextFlow})).status===200,'new enrollment retains original registration browser');
 const options=await post(register,{action:'passkeyOptions',flow:nextFlow});const registrationOptions=await options.json();check(options.status===200&&registrationOptions.options.rp.id===domain&&registrationOptions.options.authenticatorSelection.userVerification==='required','real Worker emits RP-bound UV-required registration options');
 // A second tab must not replace the method the member reviewed before confirmation.
 const syntheticProof=JSON.stringify({kind:'passkey',credentialId:'reviewed-synthetic-id',publicKey:'synthetic',counter:0,userHandle:'synthetic',rpId:domain});
 await db.prepare('UPDATE identity_flows SET proof=? WHERE id=?').bind(syntheticProof,nextFlow).run();
 const reviewed=await (await post(register,{action:'flow',flow:nextFlow})).json();
 check(reviewed.flow.proofId===digest(syntheticProof),'confirmation exposes a digest of the reviewed method');
 await db.prepare('UPDATE identity_flows SET proof=? WHERE id=?').bind(syntheticProof.replace('reviewed-synthetic-id','replacement-synthetic-id'),nextFlow).run();
 check((await post(register,{action:'finishEnrollment',flow:nextFlow,proofId:reviewed.flow.proofId})).status===409,'changed enrollment proof requires another explicit review');
 check((await db.prepare("SELECT count(*) n FROM identity_credentials WHERE member_id='member'").first()).n===0,'stale confirmation creates no credential');
 check((await post(member,{action:'complete',flow:flowId,code:fragment.get('code')})).status===409,'handoff replay denied');
 const admin=browser('admin.test.local');check((await context(admin)).r.status===403,'admin requires Access before app login');
 admin.access=await token('unmapped');check((await context(admin)).r.status===403,'valid but unmapped Access subject denied');
 admin.access=await token('owner-subject',Math.floor(Date.now()/1000)-1900);check((await context(admin)).r.status===403,'expired Access factor denied');
 admin.access=await token('owner-subject',undefined,'wrong-audience');check((await context(admin)).r.status===403,'wrong Access audience denied');
 admin.access=await token();check((await context(admin)).r.status===200,'mapped current Access subject accepted');
 check((await post(admin,{action:'adminLogin'})).status===200,'admin app session created');await context(admin);
 check((await post(admin,{action:'adminRead',query:''})).status===200,'owner identity workspace available');
 const second=browser('admin.test.local');second.access=await token('second-subject');await context(second);await post(second,{action:'adminLogin'});await context(second);
 check((await post(second,{action:'adminRead',query:''})).status===403,'second commerce administrator cannot grant new identities');
 check((await request(second.host,'/api/pilot',undefined,headers(second))).status===200,'second administrator retains commerce access');
 check((await request(domain,'/api/pilot',undefined,{Cookie:'__Host-supply-session='+admin.cookies.get('__Host-supply-admin')})).status===401,'admin token cannot be replayed as member token');
 check((await request(admin.host,'/api/pilot',undefined,{...headers(admin),'cf-access-jwt-assertion':second.access})).status===403,'Access principal must match app session');
 const state=await db.prepare("SELECT debt,credit FROM members WHERE id='member'").first();check(state.debt===725&&state.credit===250,'identity checks preserve balances');
 check(unexpectedOutbound===0,'no production/provider traffic sent');
 const result={suite:'identity-http',checks,providers:'synthetic',mfa:'signed fixture only',runtime:'compiled Worker and isolated D1',passedAt:new Date().toISOString()};writeFileSync('.sites-runtime/identity-http-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await mf.dispose();}

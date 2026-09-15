// Isolated adversarial checks for MFA, recovery, provider validation, and large histories.
import assert from 'node:assert/strict';
import {createHash,randomBytes,scryptSync} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {challengeBindings,challengeService} from './security-fixtures.mjs';
import {validateAccess,preflight} from '../scripts/security-preflight.mjs';
import './security-preflight.mjs';
const require=createRequire(import.meta.url),{Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));
const {publicKey,privateKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='fixture-key';
const issuer='https://security-test.cloudflareaccess.com',audience='fixture-admin-audience';
const mf=new Miniflare({modules:[{type:'ESModule',path:resolve('dist/server/index.js')},...readdirSync('dist/server',{recursive:true}).filter(p=>p.endsWith('.js')&&p!=='index.js').map(p=>({type:'ESModule',path:resolve('dist/server',p)}))],modulesRoot:resolve('dist/server'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{...challengeBindings,OWNER_EMAIL:'admin@example.test',ADMIN_ACCESS_TEAM_DOMAIN:issuer,ADMIN_ACCESS_AUD:audience},cf:false,outboundService:request=>request.url===issuer+'/cdn-cgi/access/certs'?Response.json({keys:[jwk]}):challengeService(request)});
let checks=0;function check(value,label){assert.ok(value,label);checks++}
const req=(path,body,cookie='',headers={})=>mf.dispatchFetch('https://test.local'+path,{redirect:'manual',method:body===undefined?'GET':'POST',headers:{Origin:'https://test.local','Content-Type':'application/json',Cookie:cookie,...headers},...(body===undefined?{}:{body:JSON.stringify({...body,challengeToken:body.challengeToken??'test-valid'})})});
const jwt=(claims={})=>new SignJWT({email:'admin@example.test',...claims}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(claims.iss||issuer).setAudience(claims.aud||audience).setSubject('fixture-admin').setIssuedAt(claims.iat??Math.floor(Date.now()/1000)).setExpirationTime(claims.exp??'30m').sign(privateKey);
try{
 const db=await mf.getD1Database('DB');
 for(const file of ['drizzle/0000_tiny_shape.sql','drizzle/0001_absent_guardsmen.sql','AUTH-SCHEMA.sql','PRODUCT-SCHEMA.sql','SECURITY-SCHEMA.sql'])await db.exec(readFileSync(file,'utf8').replace(/--> statement-breakpoint/g,'').replace(/^--.*$/gm,'').replace(/\n/g,' '));
 await db.prepare("INSERT INTO settings(id,enabled) VALUES('main',1)").run();
 const password='fixture-'+randomBytes(24).toString('hex'),salt=randomBytes(16).toString('hex'),hash=`scrypt$16384$8$5$${salt}$${scryptSync(password,salt,32,{N:16384,r:8,p:5,maxmem:33554432}).toString('hex')}`;
 const cookies={},tokens={};
 for(const [id,role] of [['admin','admin'],['member','member'],['other','member']]){
  await db.prepare('INSERT INTO members(id,user_id,email,name,role) VALUES(?,?,?,?,?)').bind(id,id,id+'@example.test',id,role).run();
  await db.prepare('INSERT INTO auth_credentials(member_id,password_hash,updated_at) VALUES(?,?,?)').bind(id,hash,Date.now()).run();
  const r=await req('/api/auth',{action:'login',email:id+'@example.test',password});check(r.status===200,id+' login works');cookies[id]=r.headers.get('set-cookie').split(';')[0];tokens[id]=createHash('sha256').update(cookies[id].split('=')[1]).digest('hex');
 }
 const admin=cookies.admin,member=cookies.member;
 check(!(await (await req('/api/pilot?view=admin',undefined,admin)).json()).admin,'password-only administrator cannot read management');
 for(const [path,body] of [['/api/pilot',{action:'settings'}],['/api/auth',{action:'issueRecovery',memberId:'member',identityVerified:true}],['/api/product-images',{}],['/api/export?dataset=members',undefined],['/api/history?scope=admin&dataset=members',undefined],['/api/history?dataset=performance&productId=gear',undefined]]){
  const r=await req(path,body,admin);check(r.status===403,'MFA required on '+path);
 }
 for(const token of ['forged',await jwt({email:'other@example.test'}),await jwt({aud:'other-app'}),await jwt({iss:'https://other.cloudflareaccess.com'}),await jwt({exp:Math.floor(Date.now()/1000)-1}),await jwt({iat:Math.floor(Date.now()/1000)-1900})]){
  const r=await req('/api/admin/access',undefined,admin,{'cf-access-jwt-assertion':token});check(r.status===403,'invalid Access proof rejected: '+r.status);
 }
 await db.prepare("DELETE FROM auth_limits WHERE id LIKE 'admin-access:%'").run();
 let r=await req('/api/admin/access',undefined,admin,{'cf-access-jwt-assertion':await jwt()});check(r.status===303&&r.headers.get('location')?.endsWith('/?view=admin'),'valid matching Access JWT grants this session: '+r.status+' '+await r.clone().text());
 check(!!(await (await req('/api/pilot?view=admin',undefined,admin)).json()).admin,'MFA-verified administrator can read management');
 const otherAdmin=(await req('/api/auth',{action:'login',email:'admin@example.test',password})).headers.get('set-cookie').split(';')[0];check(!(await (await req('/api/pilot?view=admin',undefined,otherAdmin)).json()).admin,'MFA proof does not apply to another device session');
 check((await req('/api/admin/access',undefined,member,{'cf-access-jwt-assertion':await jwt()})).status===403,'Access identity alone never grants an application role');
 for(const challengeToken of ['', 'wrong-host','wrong-action','invalid'])check((await req('/api/auth',{action:'login',email:'member@example.test',password,challengeToken})).status===403,'invalid challenge denied: '+challengeToken);
 check((await req('/api/auth',{action:'issueRecovery',memberId:'member'},admin)).status===400,'recovery requires identity-verification confirmation');
 r=await req('/api/auth',{action:'issueRecovery',memberId:'member',identityVerified:true},admin);let recovery=await r.json();check(r.status===200&&recovery.code.length===32,'admin issues 128-bit private recovery code');
 check((await req('/api/auth',{action:'completeRecovery',email:'other@example.test',code:recovery.code,password:'new-fixture-password-2026'})).status===403,'recovery code cannot claim another identity');
 const stored=await db.prepare("SELECT code_hash,expires_at FROM auth_recovery WHERE member_id='member'").first();check(stored.code_hash!==recovery.code&&stored.expires_at<=Date.now()+3600000,'only hash and bounded expiry stored');
 const recovered=await Promise.all([0,1].map(i=>req('/api/auth',{action:'completeRecovery',email:'member@example.test',code:recovery.code,password:'new-fixture-password-2026-'+i})));
 check(recovered.filter(r=>r.status===200).length===1&&recovered.every(r=>[200,403,409].includes(r.status)),'recovery code consumed once under concurrent redemption');
 check((await req('/api/pilot',undefined,member)).status===401,'recovery invalidates all previous member sessions');
 check(!(await db.prepare("SELECT 1 FROM auth_recovery WHERE member_id='member'").first()),'recovery code removed after use');
 const newMember=recovered.find(r=>r.status===200).headers.get('set-cookie').split(';')[0];
 // A long ledger is paginated; totals include every historical entry.
 await db.prepare("INSERT INTO products(id,name,category,price,cost,tax_bp,stock,active) VALUES('gear','Shirt','Gear',100,50,0,100,1)").run();
 await db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<501) INSERT INTO orders(id,code,fingerprint,member_id,payer,method,total,tax,cost,status,created_at) SELECT printf('order-%04d',x),printf('code-%04d',x),'synthetic','member',CASE WHEN x=1 THEN '=1+1' ELSE 'Member' END,'cash',100,0,50,'paid',1000 FROM n").run();
 await db.prepare("INSERT INTO order_items(id,order_id,product_id,name,qty,price,cost,tax_bp,preorder) SELECT 'item-'||id,id,'gear','Shirt',1,100,50,0,0 FROM orders").run();
 await db.prepare("INSERT INTO order_item_details(item_id,fulfillment,updated_at) SELECT id,'ready',1000 FROM order_items").run();
 const state=await (await req('/api/pilot?view=admin',undefined,admin)).json();check(state.admin.summary.sales===50100&&state.admin.summary.costs===25050,'lifetime financial summary includes every row');
 check(state.admin.orders.length===8&&state.admin.pages.orders,'overview fetches eight recent orders and a cursor');
 const catalog=await (await req('/api/pilot?view=catalog',undefined,newMember)).json();check(catalog.orders.length===0&&!catalog.admin,'catalog does not load account or admin history');
 let cursor='',seen=new Set(),pages=0;
 do{const result=await (await req('/api/history?dataset=orders&cursor='+encodeURIComponent(cursor),undefined,newMember)).json();check(result.records.length<=50&&result.records.every(o=>!('cost' in o)&&!('fingerprint' in o)),'member history page protects costs');for(const record of result.records){check(!seen.has(record.id),'keyset pagination never duplicates tie timestamps');seen.add(record.id)}cursor=result.nextCursor;pages++}while(cursor);
 check(seen.size===501&&pages===11,'all old orders remain reachable across pages');
 check((await (await req('/api/history?dataset=orders&memberId=member',undefined,cookies.other)).json()).records.length===0,'forged member selector cannot read another account history');
 check((await req('/api/history?scope=admin&dataset=members',undefined,newMember)).status===403,'member cannot select admin history scope');
 check((await req('/api/history?dataset=orders&cursor=not-json',undefined,newMember)).status===400,'invalid cursor rejected');
 r=await req('/api/history?dataset=pickups&filter=open',undefined,newMember);const pickups=await r.json();check(pickups.records.length===50&&pickups.nextCursor,'older ready gear is reachable independently of order page');
 const performance=await (await req('/api/history?dataset=performance&productId=gear',undefined,admin)).json();check(performance.stats.units===501&&performance.stats.profit===25050,'pricing totals use complete immutable cost snapshots');
 r=await req('/api/export?dataset=purchases',undefined,admin);const csv=await r.text();check(r.status===200&&csv.split('\r\n').filter(Boolean).length===502,'streamed export contains header plus all 501 orders');check(csv.includes("'=1+1"),'CSV spreadsheet formulas escaped');
 const historyCursor=(await (await req('/api/history?scope=admin&dataset=orders',undefined,admin)).json()).nextCursor;
 await db.prepare('UPDATE auth_admin_access SET expires_at=? WHERE token_hash=?').bind(Date.now()-1,tokens.admin).run();
 check((await req('/api/history?scope=admin&dataset=orders&cursor='+historyCursor,undefined,admin)).status===403,'MFA expiration is rechecked on the next page');
 check((await req('/api/export?dataset=purchases',undefined,admin)).status===403,'expired MFA cannot export');
 const snapshot=JSON.stringify((await db.prepare('SELECT * FROM orders ORDER BY id').all()).results);await db.exec(readFileSync('SECURITY-SCHEMA.sql','utf8').replace(/^--.*$/gm,'').replace(/\n/g,' '));check(JSON.stringify((await db.prepare('SELECT * FROM orders ORDER BY id').all()).results)===snapshot,'reapplying security schema preserves live-shaped business records');
 const policy={decision:'allow',include:[{email:{email:'admin@example.test'}}],mfa_config:{mfa_disabled:false,session_duration:'30m',allowed_authenticators:['security_key','biometrics']}};
 const app={type:'self_hosted',domain:'iyaayasfw.com/api/admin/access',aud:audience,session_duration:'30m'},org={auth_domain:'security-test.cloudflareaccess.com',mfa_config:{amr_matching_enabled:false,amr_session_duration:'1h'}};
 validateAccess(app,[policy],org,audience,issuer);checks++;
 for(const mfa_config of [{amr_matching_enabled:true,amr_session_duration:'1h'},{amr_matching_enabled:true,amr_session_duration:'0m'},{amr_matching_enabled:'false'},{},undefined]){assert.throws(()=>validateAccess(app,[policy],{...org,mfa_config},audience,issuer),/Disable IdP AMR matching/);checks++}
 for(const bad of [{...policy,decision:'bypass'},{...policy,mfa_config:{...policy.mfa_config,mfa_disabled:true}},{...policy,mfa_config:{...policy.mfa_config,allowed_authenticators:['totp']}},{...policy,include:[{everyone:{}}]}]){assert.throws(()=>validateAccess(app,[bad],org,audience,issuer));checks++}
 let outbound=0;await assert.rejects(()=>preflight({}, {CF_PAGES:'1'},async()=>{outbound++}),/Cloudflare Pages/);check(outbound===0,'Pages deployment stops before any remote operation');
 await assert.rejects(()=>preflight({}, {WORKERS_CI_BRANCH:'feature'},async()=>{outbound++}),/main/);check(outbound===0,'non-main deploy stops before any remote operation');
 console.log(`${checks} MFA, recovery, provider, pagination, export, and release-gate checks passed.`);
}finally{await mf.dispose()}

// Sixty distinct synthetic members, one synthetic IP, no provider/production calls.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {scryptSync,createHash} from 'node:crypto';
import {challengeBindings,challengeService} from './security-fixtures.mjs';
const require=createRequire(import.meta.url),{Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));
const baseline=process.argv.includes('--baseline');
const concurrency=Number(process.argv.find(x=>x.startsWith('--concurrency='))?.split('=')[1]||60);assert.ok(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=60);
const mf=new Miniflare({workers:[{name:'application',modules:[{type:'ESModule',path:resolve('dist/server/index.js')},...readdirSync('dist/server',{recursive:true}).filter(p=>p.endsWith('.js')&&p!=='index.js').map(p=>({type:'ESModule',path:resolve('dist/server',p)}))],modulesRoot:resolve('dist/server'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:challengeBindings,outboundService:'turnstile-fixture'},{name:'turnstile-fixture',modules:true,compatibilityDate:'2026-05-15',script:`export default {async fetch(request){const u=new URL(request.url);if(u.href!=='https://challenges.cloudflare.com/turnstile/v0/siteverify')return new Response('Unexpected fixture URL',{status:502});const b=await request.json();return Response.json({success:b.secret==='test-secret'&&b.response==='test-valid',hostname:'test.local',action:'account'});}}`}],cf:false});
try{
 const db=await mf.getD1Database('DB');for(const file of [...readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort().map(x=>'drizzle/'+x),...['AUTH','PRODUCT','SECURITY','BETA','ROUNDS','GUEST','AUTOPILOT','REWARDS','EARNING','REDEMPTION','PROFILE-EXPERIENCE','ADMIN-EXPERIENCE','WORKFLOW'].map(x=>x+'-SCHEMA.sql')])await db.exec(readFileSync(file,'utf8').replace(/--> statement-breakpoint/g,'').replace(/^--.*$/gm,'').replace(/\n/g,' '));
 const password='Synthetic NAT password 13579',salt='12345678901234567890123456789012',hash='scrypt$16384$8$5$'+salt+'$'+scryptSync(password,salt,32,{N:16384,r:8,p:5,maxmem:32*1024*1024}).toString('hex');
 for(let n=0;n<60;n++){await db.prepare('INSERT INTO members(id,email,name) VALUES(?,?,?)').bind('nat-'+n,'nat-'+n+'@example.test','Synthetic '+n).run();await db.prepare('INSERT INTO auth_credentials VALUES(?,?,?)').bind('nat-'+n,hash,Date.now()).run();}
 const request=(n,wrong=false)=>mf.dispatchFetch('https://test.local/api/auth',{method:'POST',headers:{Origin:'https://test.local','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.60'},body:JSON.stringify({action:'login',email:'nat-'+n+'@example.test',password:wrong?'wrong password':password,challengeToken:'test-valid'})});
 const begin=performance.now(),results=[];let next=0;
 await Promise.all(Array.from({length:concurrency},async()=>{while(next<60){const n=next++,start=performance.now(),r=await request(n);const cookie=r.headers.get('set-cookie')?.split(';')[0];await r.arrayBuffer();results.push({n,cookie,status:r.status,ms:performance.now()-start});}}));
 for(const result of results.filter(r=>r.status===200)){assert.ok(result.cookie);const value=result.cookie.slice(result.cookie.indexOf('=')+1),row=await db.prepare('SELECT member_id FROM auth_sessions WHERE token_hash=?').bind(createHash('sha256').update(value).digest('hex')).first();assert.equal(row.member_id,'nat-'+result.n);}
 const statuses=Object.fromEntries([...new Set(results.map(x=>x.status))].map(s=>[s,results.filter(x=>x.status===s).length]));
 assert.equal(statuses[200],baseline?40:60);assert.equal(statuses[429]||0,baseline?20:0);
 if(!baseline){let last;for(let i=0;i<10;i++)last=await request(0,true);assert.equal(last.status,429,'per-account abuse limit still applies');}
 const times=results.map(x=>x.ms).sort((a,b)=>a-b),result={baseline,members:60,concurrentRequests:concurrency,sharedIp:true,statuses,p50Ms:Math.round(times[29]),p95Ms:Math.round(times[56]),maxMs:Math.round(times[59]),totalMs:Math.round(performance.now()-begin),accountBindings:'all successful sessions matched their intended member',environment:'local isolated Workers runtime; synthetic Turnstile; no production traffic',testedAt:new Date().toISOString()};
 writeFileSync('.sites-runtime/shared-nat-'+(baseline?'baseline':'candidate')+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await mf.dispose();}

// Explicit manual release path. Automatic main-only deployment retains its
// existing preflight. This command validates a fresh read-only API snapshot and
// prepares a configuration; it never deploys or mutates Cloudflare resources.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {ACCOUNT,WORKER,HOST,validateAccess} from './security-preflight.mjs';
const ADMIN_APP='49519f7c-2a3a-498c-b90e-87524632ec46';
const DB='ed7e63c8-77fd-4314-ab35-131c061e016a';
const methods=['GOOGLE','MICROSOFT','PASSKEY'];
export function validateIdentityRelease(config,snapshot,stage,commit){
 assert.ok(['owner-smoke','member-beta','all-approved'].includes(stage),'Choose an explicit release stage.');
 assert.equal(snapshot.account,ACCOUNT);
 assert.match(commit,/^[a-f0-9]{40}$/);
 assert.equal(snapshot.commit,commit,'Snapshot must identify this candidate commit.');
 assert.ok(Date.now()-Date.parse(snapshot.observedAt)<600000&&Date.parse(snapshot.observedAt)<=Date.now(),'Read Cloudflare security state within ten minutes of preparing the release.');
 const get=path=>{const response=snapshot.responses[path];assert.ok(response?.success===true,'Missing successful API evidence: '+path);assert.ok(!response.result_info?.total_pages||response.result_info.total_pages===1,'Review paginated evidence: '+path);return response.result;};
 const settings=get('/workers/scripts/'+WORKER+'/settings'),bindings=settings.bindings;
 const binding=name=>bindings.find(b=>b.name===name),value=name=>binding(name)?.text;
 assert.equal(binding('DB')?.id,DB);assert.equal(binding('BUCKET')?.bucket_name,'iyaayasfw-supply-images');
 for(const name of ['OWNER_EMAIL','TURNSTILE_SECRET_KEY','GOOGLE_CLIENT_SECRET','MICROSOFT_CLIENT_SECRET'])assert.equal(binding(name)?.type,'secret_text','Missing runtime secret '+name);
 assert.ok(!binding('BOOTSTRAP_PASSWORD'),'Initial bootstrap password must remain removed.');
 for(const name of ['ADMIN_ACCESS_TEAM_DOMAIN','ADMIN_ACCESS_AUD','ADMIN_ACCESS_APP_ID','TURNSTILE_SITE_KEY','GOOGLE_CLIENT_ID','MICROSOFT_CLIENT_ID'])assert.ok(typeof value(name)==='string'&&value(name).length>0,'Missing text setting '+name);
 assert.match(value('ADMIN_ACCESS_TEAM_DOMAIN'),/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/);
 const organization=get('/access/organizations');
 validateAccess(get('/access/apps/'+value('ADMIN_ACCESS_APP_ID')),get('/access/apps/'+value('ADMIN_ACCESS_APP_ID')+'/policies'),organization,value('ADMIN_ACCESS_AUD'),value('ADMIN_ACCESS_TEAM_DOMAIN'));
 const admin=get('/access/apps/'+ADMIN_APP),policies=get('/access/apps/'+ADMIN_APP+'/policies');
 validateAccess(admin,policies,organization,admin.aud,value('ADMIN_ACCESS_TEAM_DOMAIN'),'admin.'+HOST);
 assert.deepEqual(admin.allowed_idps,['b23d3b2c-75e8-4671-9b00-c792563c1ac0']);
 assert.equal(admin.options_preflight_bypass,false);assert.equal(admin.allow_authenticate_via_warp,false);
 assert.equal(admin.enable_binding_cookie,true);assert.equal(admin.http_only_cookie_attribute,true);
 assert.ok(policies.every(p=>p.reusable===true));
 assert.deepEqual([...new Set(policies.filter(p=>p.decision==='allow').flatMap(p=>p.include.map(r=>r.email.email)))].sort(),snapshot.approvedAdminEmails.slice().sort(),'Access allow list must match explicitly approved existing administrators.');
 const widget=get('/challenges/widgets/'+value('TURNSTILE_SITE_KEY'));
 assert.equal(widget.mode,'managed');assert.deepEqual(widget.domains,[HOST]);
 assert.equal(get('/r2/buckets/iyaayasfw-supply-images/domains/managed').enabled,false);
 assert.ok(get('/r2/buckets/iyaayasfw-supply-images/domains/custom').domains.every(d=>d.enabled===false));
 assert.ok(!get('/pages/projects').some(p=>p.name==='iyaayasfw'),'Retired Pages project must remain absent.');
 for(const [worker,tag] of [[WORKER,'1e5b40897e4243699fe5d1439b11f0d4'],['iyaayasfw-gear','0b7991fd58744e86a2909c425168a686']]){
  assert.deepEqual(get('/workers/scripts/'+worker+'/subdomain'),{enabled:false,previews_enabled:false});
  const triggers=get('/builds/workers/'+tag+'/triggers');assert.equal(triggers.length,1);
  assert.deepEqual(triggers[0].branch_includes,['main']);assert.equal(triggers[0].deploy_command,`node -e "throw new Error('Production release paused for identity rollout review')"`);
 }
 const domains=get('/workers/domains');
 for(const d of domains.filter(d=>d.service===WORKER))assert.ok([HOST,'auth.'+HOST,'register.'+HOST,'admin.'+HOST].includes(d.hostname),'Unexpected main Worker domain');
 assert.ok(domains.some(d=>d.hostname===HOST&&d.service===WORKER));
 assert.ok(domains.some(d=>d.hostname==='gear.'+HOST&&d.service==='iyaayasfw-gear'));
 assert.equal(config.name,WORKER);assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);
 assert.equal(config.keep_vars,true);assert.equal(config.observability?.logs?.invocation_logs,false);
 assert.equal(config.d1_databases?.length,1);assert.equal(config.d1_databases[0].binding,'DB');
 assert.deepEqual(config.r2_buckets,[{binding:'BUCKET',bucket_name:'iyaayasfw-supply-images'}]);
 assert.equal(snapshot.ci?.commit,commit);assert.equal(snapshot.ci?.conclusion,'success','Candidate Linux checks must pass.');
 assert.equal(snapshot.recovery?.restore,'passed');assert.equal(snapshot.recovery?.keyRetrievedFromVault,true);
 assert.ok(Date.now()-Date.parse(snapshot.recovery?.verifiedAt)<86400000,'Refresh protected recovery evidence before release.');
 if(stage==='member-beta'){
  assert.equal(snapshot.beta?.authorization,'owner-request-whitelist-registration','Record the explicit owner request for whitelist-controlled registration without another beta unlock.');
  assert.equal(snapshot.beta?.audience,'active-member-whitelist');
  assert.equal(snapshot.beta?.sql,'SELECT id,role FROM members WHERE active=1 ORDER BY id');
  const roster=get('/d1/database/'+DB+'/query');
  assert.equal(roster.length,1);assert.equal(roster[0].success,true);
  assert.ok(roster[0].results.some(row=>row.id==='owner'&&row.role==='admin'),'Verify the owner remains an active whitelisted administrator.');
  for(const gate of ['google','microsoft','iphoneSafari','adminMfaDenial','ownerRecovery'])assert.equal(snapshot.realTests?.[gate],'passed','Missing owner acceptance before beta: '+gate);
  assert.ok(snapshot.mappedAdminMembers?.includes('owner'),'The owner needs a verified administrator mapping.');
  assert.equal(snapshot.beta?.fullReleaseReady,false,'Beta is not a completed full-release acceptance.');
 }
 if(stage==='all-approved'){
  for(const gate of ['google','microsoft','iphoneSafari','androidChrome','desktop','adminMfaDenial','ownerRecovery','legacyCommerceSmoke'])assert.equal(snapshot.realTests?.[gate],'passed','Missing real test: '+gate);
  assert.deepEqual(snapshot.mappedAdminMembers?.slice().sort(),['owner','659acffe-8042-49de-a2cf-9db261aef0e5'].sort(),'Both administrators require verified mappings before cutover.');
 }
 const prepared=structuredClone(config);
 prepared.d1_databases[0].database_id=DB;
 prepared.routes=[HOST,'auth.'+HOST,'register.'+HOST,'admin.'+HOST].map(pattern=>({pattern,custom_domain:true}));
 prepared.vars={...config.vars,IDENTITY_ENABLED:'true',IDENTITY_ROLLOUT:stage,IDENTITY_OWNER_MEMBER_ID:'owner',IDENTITY_BASE_DOMAIN:HOST,IDENTITY_ADMIN_ACCESS_AUD:admin.aud,IDENTITY_GOOGLE_BOOTSTRAP_ENABLED:'false',...Object.fromEntries(methods.map(m=>['IDENTITY_'+m+'_ENABLED','true']))};
 for(const name of ['ADMIN_ACCESS_TEAM_DOMAIN','ADMIN_ACCESS_AUD','ADMIN_ACCESS_APP_ID','TURNSTILE_SITE_KEY','GOOGLE_CLIENT_ID','MICROSOFT_CLIENT_ID'])assert.ok(!Object.hasOwn(prepared.vars,name)||prepared.vars[name]===value(name),'Configuration would replace validated '+name);
 return prepared;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [snapshotPath,stage,commit]=process.argv.slice(2);
 const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
 assert.equal(git('rev-parse','HEAD'),commit,'Release exactly the reviewed commit.');
 assert.equal(git('status','--porcelain'),'','Commit changes before preparing a candidate.');
 assert.match(git('branch','--show-current'),/^(main|codex\/identity-team-test-2026-09-21)$/);
 const snapshot=JSON.parse(readFileSync(snapshotPath,'utf8'));
 const prepared=validateIdentityRelease(JSON.parse(readFileSync('dist/server/wrangler.json','utf8')),snapshot,stage,commit);
 const serialized=JSON.stringify(prepared,null,2)+'\n',output='dist/server/identity-release.json';
 writeFileSync(output,serialized);
 console.log(JSON.stringify({prepared:output,stage,commit,configSha256:createHash('sha256').update(serialized).digest('hex'),next:'Review dry run, verify protected recovery and existing schema/principal evidence, then deploy this exact configuration. No remote changes performed.'}));
}

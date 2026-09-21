import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateIdentityRelease} from '../scripts/prepare-identity-release.mjs';
const config=JSON.parse(readFileSync('wrangler.json','utf8')),commit='a'.repeat(40);
const issuer='https://fixture.cloudflareaccess.com',appId='fixture-app',adminId='49519f7c-2a3a-498c-b90e-87524632ec46';
const policy={decision:'allow',reusable:true,include:[{email:{email:'one@example.test'}},{email:{email:'two@example.test'}}],mfa_config:{mfa_disabled:false,session_duration:'30m',allowed_authenticators:['security_key','biometrics']}};
const app={type:'self_hosted',domain:'iyaayasfw.com/api/admin/access',aud:'legacy-aud',session_duration:'30m'};
const bindings=[...Object.entries({ADMIN_ACCESS_TEAM_DOMAIN:issuer,ADMIN_ACCESS_APP_ID:appId,ADMIN_ACCESS_AUD:'legacy-aud',TURNSTILE_SITE_KEY:'fixture-site',GOOGLE_CLIENT_ID:'fixture-google',MICROSOFT_CLIENT_ID:'fixture-microsoft'}).map(([name,text])=>({name,type:'plain_text',text})),...['OWNER_EMAIL','TURNSTILE_SECRET_KEY','GOOGLE_CLIENT_SECRET','MICROSOFT_CLIENT_SECRET'].map(name=>({name,type:'secret_text'})),{name:'DB',id:'ed7e63c8-77fd-4314-ab35-131c061e016a'},{name:'BUCKET',bucket_name:'iyaayasfw-supply-images'}];
const values={
 '/workers/scripts/iyaayasfw-supply/settings':{bindings},
 ['/access/apps/'+appId]:app,['/access/apps/'+appId+'/policies']:[policy],
 ['/access/apps/'+adminId]:{...app,domain:'admin.iyaayasfw.com',aud:'new-aud',allowed_idps:['b23d3b2c-75e8-4671-9b00-c792563c1ac0'],options_preflight_bypass:false,allow_authenticate_via_warp:false,enable_binding_cookie:true,http_only_cookie_attribute:true},
 ['/access/apps/'+adminId+'/policies']:[policy],
 '/access/organizations':{auth_domain:'fixture.cloudflareaccess.com',mfa_config:{allowed_authenticators:['security_key'],session_duration:'30m'}},
 '/challenges/widgets/fixture-site':{mode:'managed',domains:['iyaayasfw.com']},
 '/r2/buckets/iyaayasfw-supply-images/domains/managed':{enabled:false},
 '/r2/buckets/iyaayasfw-supply-images/domains/custom':{domains:[]},
 '/pages/projects':[],
 '/workers/domains':[{hostname:'iyaayasfw.com',service:'iyaayasfw-supply'},{hostname:'gear.iyaayasfw.com',service:'iyaayasfw-gear'}]
};
for(const [worker,tag] of [['iyaayasfw-supply','1e5b40897e4243699fe5d1439b11f0d4'],['iyaayasfw-gear','0b7991fd58744e86a2909c425168a686']]){
 values['/workers/scripts/'+worker+'/subdomain']={enabled:false,previews_enabled:false};
 values['/builds/workers/'+tag+'/triggers']=[{branch_includes:['main'],deploy_command:`node -e "throw new Error('Production release paused for identity rollout review')"`}];
}
const snapshot={account:'60bbba10092a452ee58b3bff5c92a894',observedAt:new Date().toISOString(),commit,approvedAdminEmails:['one@example.test','two@example.test'],ci:{commit,conclusion:'success'},recovery:{restore:'passed',keyRetrievedFromVault:true,verifiedAt:new Date().toISOString()},responses:Object.fromEntries(Object.entries(values).map(([p,result])=>[p,{success:true,result}]))};
let checks=0;const good=validateIdentityRelease(config,snapshot,'owner-smoke',commit);
assert.equal(good.routes.length,4);assert.equal(good.vars.IDENTITY_ROLLOUT,'owner-smoke');assert.equal(config.vars.IDENTITY_ENABLED,'false');checks++;
assert.throws(()=>validateIdentityRelease(config,snapshot,'all-approved',commit));checks++;
for(const mutate of [s=>s.observedAt='2020-01-01',s=>s.commit='b'.repeat(40),s=>s.ci.conclusion='failure',s=>s.recovery.keyRetrievedFromVault=false,s=>s.approvedAdminEmails.push('third@example.test'),s=>s.responses['/pages/projects'].result.push({name:'iyaayasfw'}),s=>s.responses['/workers/scripts/iyaayasfw-supply/subdomain'].result.enabled=true,s=>s.responses['/access/apps/'+adminId+'/policies'].result[0].decision='bypass',s=>s.responses['/access/organizations'].result.mfa_config.amr_matching_enabled=true,s=>s.responses['/r2/buckets/iyaayasfw-supply-images/domains/managed'].result.enabled=true,s=>delete s.responses['/workers/domains'],s=>s.responses['/access/apps/'+adminId+'/policies'].result_info={total_pages:2}]){
 const broken=structuredClone(snapshot);mutate(broken);assert.throws(()=>validateIdentityRelease(config,broken,'owner-smoke',commit));checks++;
}
const full=structuredClone(snapshot);full.realTests=Object.fromEntries(['google','microsoft','iphoneSafari','androidChrome','desktop','adminMfaDenial','ownerRecovery','legacyCommerceSmoke'].map(k=>[k,'passed']));full.mappedAdminMembers=['owner','659acffe-8042-49de-a2cf-9db261aef0e5'];
assert.equal(validateIdentityRelease(config,full,'all-approved',commit).vars.IDENTITY_ROLLOUT,'all-approved');checks++;
full.mappedAdminMembers=['owner'];assert.throws(()=>validateIdentityRelease(config,full,'all-approved',commit));checks++;
const beta=structuredClone(snapshot),rosterPath='/d1/database/ed7e63c8-77fd-4314-ab35-131c061e016a/query';
beta.beta={authorization:'owner-request-current-member-beta',memberIds:['owner','member'],sql:'SELECT id,role FROM members WHERE active=1 ORDER BY id',fullReleaseReady:false};
beta.responses[rosterPath]={success:true,result:[{success:true,results:[{id:'owner',role:'admin'},{id:'member',role:'member'}]}]};
beta.realTests=Object.fromEntries(['google','microsoft','iphoneSafari','adminMfaDenial','ownerRecovery'].map(k=>[k,'passed']));beta.mappedAdminMembers=['owner'];
const preparedBeta=validateIdentityRelease(config,beta,'member-beta',commit);
assert.equal(preparedBeta.vars.IDENTITY_ROLLOUT,'member-beta');assert.deepEqual(JSON.parse(preparedBeta.vars.IDENTITY_BETA_MEMBER_IDS),['member','owner']);checks++;
assert.throws(()=>validateIdentityRelease(config,beta,'all-approved',commit),'Beta evidence cannot satisfy full-release gates');checks++;
for(const mutate of [s=>delete s.beta.authorization,s=>s.beta.memberIds=[],s=>s.beta.memberIds=['owner','unknown'],s=>s.beta.memberIds=['owner','owner'],s=>s.beta.memberIds=['member'],s=>s.beta.memberIds=['owner','bad id'],s=>s.beta.fullReleaseReady=true,s=>s.beta.sql='SELECT id FROM members',s=>delete s.responses[rosterPath],s=>s.responses[rosterPath].result[0].success=false,s=>s.responses[rosterPath].result[0].results=[],s=>s.mappedAdminMembers=[],s=>s.realTests.adminMfaDenial='pending']){
 const broken=structuredClone(beta);mutate(broken);assert.throws(()=>validateIdentityRelease(config,broken,'member-beta',commit));checks++;
}
console.log(`${checks} manual identity release gate checks passed; no remote operations.`);

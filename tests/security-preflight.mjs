// Provider response compatibility without credentials, a database, or network access.
import assert from 'node:assert/strict';
import {validateAccess,validateAmrMatching,preflight} from '../scripts/security-preflight.mjs';
const legacy={allowed_authenticators:['security_key','biometrics'],session_duration:'30m'};
let checks=0;
for(const duration of [undefined,null,'','0m','0h']){
 const config={...legacy};if(duration!==undefined)config.amr_matching_session_duration=duration;
 assert.doesNotThrow(()=>validateAmrMatching(config));checks++;
}
for(const config of [{amr_matching_enabled:false},{amr_matching_enabled:false,amr_session_duration:'24h'},{...legacy,amr_matching_enabled:false,amr_matching_session_duration:'0m'}]){
 assert.doesNotThrow(()=>validateAmrMatching(config));checks++;
}
for(const duration of ['1m','30m','24h',false,0,{},[], '0', 'unknown']){
 for(const config of [{...legacy,amr_matching_session_duration:duration},{...legacy,amr_matching_enabled:false,amr_matching_session_duration:duration}]){
  assert.throws(()=>validateAmrMatching(config),/duration-based AMR/);checks++;
 }
}
for(const config of [undefined,null,{},[],{amr_matching_enabled:'false'},{amr_matching_enabled:null},{...legacy,amr_matching_enabled:true},{...legacy,amr_matching_enabled:true,amr_matching_session_duration:'0m'},{...legacy,amr_matching_enabled:true,amr_session_duration:'0m'},{...legacy,amr_session_duration:'24h'},{...legacy,amr_unknown:true},{session_duration:'30m'},{allowed_authenticators:[]},{...legacy,session_duration:'24h'}]){
 assert.throws(()=>validateAmrMatching(config),/Disable IdP AMR matching/);checks++;
}
const audience='test-audience',issuer='https://test-team.cloudflareaccess.com';
const app={type:'self_hosted',domain:'iyaayasfw.com/api/admin/access',aud:audience,session_duration:'30m'};
const policy={decision:'allow',include:[{email:{email:'admin@example.test'}}],mfa_config:{mfa_disabled:false,session_duration:'30m',allowed_authenticators:['security_key','biometrics']}};
const organization={auth_domain:'test-team.cloudflareaccess.com',mfa_config:legacy};
assert.doesNotThrow(()=>validateAccess(app,[policy],organization,audience,issuer));checks++;
for(const bad of [{...policy,decision:'bypass'},{...policy,include:[{everyone:{}}]},{...policy,mfa_config:{...policy.mfa_config,mfa_disabled:true}},{...policy,mfa_config:{...policy.mfa_config,allowed_authenticators:['totp']}}]){
 assert.throws(()=>validateAccess(app,[bad],organization,audience,issuer));checks++;
}
const config={name:'iyaayasfw-supply',workers_dev:false,preview_urls:false,routes:[{pattern:'iyaayasfw.com',custom_domain:true}]};
const bindings=[
 ...Object.entries({ADMIN_ACCESS_TEAM_DOMAIN:issuer,ADMIN_ACCESS_AUD:audience,ADMIN_ACCESS_APP_ID:'5582a373-919d-44d6-960f-fb2b43f46892',TURNSTILE_SITE_KEY:'test-site-key-1234'}).map(([name,text])=>({name,type:'plain_text',text})),
 {name:'TURNSTILE_SECRET_KEY',type:'secret_text'},{name:'OWNER_EMAIL',type:'secret_text'},
 {name:'DB',id:'ed7e63c8-77fd-4314-ab35-131c061e016a'},{name:'BUCKET',bucket_name:'iyaayasfw-supply-images'}
];
const replies=new Map([
 ['/workers/scripts/iyaayasfw-supply/settings',{bindings}],
 ['/access/apps/5582a373-919d-44d6-960f-fb2b43f46892',app],
 ['/access/apps/5582a373-919d-44d6-960f-fb2b43f46892/policies',[policy]],
 ['/access/organizations',organization],
 ['/challenges/widgets/test-site-key-1234',{mode:'managed',domains:['iyaayasfw.com']}],
 ['/r2/buckets/iyaayasfw-supply-images/domains/managed',{enabled:false}],
 ['/r2/buckets/iyaayasfw-supply-images/domains/custom',{domains:[]}]
]);
let reads=0;
const fetcher=async(url,options)=>{
 assert.equal(options.method??'GET','GET');
 const path=new URL(url).pathname.replace('/client/v4/accounts/60bbba10092a452ee58b3bff5c92a894','');
 assert.ok(replies.has(path),'Unexpected provider endpoint');reads++;
 return Response.json({success:true,result:replies.get(path)});
};
const environment={WORKERS_CI_BRANCH:'main',CLOUDFLARE_SECURITY_READ_TOKEN:'fixture-only'};
await preflight(config,environment,fetcher);assert.equal(reads,7);assert.equal(config.keep_vars,true);checks++;
organization.mfa_config={...legacy,amr_matching_session_duration:'30m'};
await assert.rejects(()=>preflight(config,environment,fetcher),/duration-based AMR/);checks++;
console.log(`${checks} provider MFA compatibility and read-only preflight checks passed.`);

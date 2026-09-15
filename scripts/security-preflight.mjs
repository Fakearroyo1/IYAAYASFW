// Read-only release validation. No remote settings or records are changed here.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const ACCOUNT='60bbba10092a452ee58b3bff5c92a894',WORKER='iyaayasfw-supply',HOST='iyaayasfw.com';
const requireThat=(ok,message)=>{if(!ok)throw Error(message)};
const shortSession=value=>typeof value==='string'&&/^(?:[1-9]|[12][0-9]|30)m$/.test(value);
export function validateAccess(app,policies,organization,audience,issuer){
 requireThat(app.type==='self_hosted'&&app.domain===HOST+'/api/admin/access','Access must protect the exact administrator verification callback.');
 requireThat(app.aud===audience,'Access audience does not match the Worker runtime variable.');
 requireThat(organization.auth_domain===new URL(issuer).hostname,'Access issuer does not match the account organization.');
 requireThat(shortSession(app.session_duration),'Access application session must be 30 minutes or less.');
 requireThat(policies.length>0&&policies.every(p=>['allow','deny'].includes(p.decision)),'Access must have allow policies and no bypass/service-auth policies.');
 const allows=policies.filter(p=>p.decision==='allow');requireThat(allows.length>0,'No administrator Access allow policy exists.');
 for(const policy of allows){
  requireThat(policy.include?.length>0&&policy.include.every(r=>typeof r.email?.email==='string'&&r.email.email.includes('@')),'Use explicit approved administrator emails in every allow policy.');
  const mfa=policy.mfa_config;
  requireThat(mfa?.mfa_disabled===false&&shortSession(mfa.session_duration)&&mfa.allowed_authenticators?.length>0&&mfa.allowed_authenticators.every(v=>['security_key','biometrics'].includes(v)),'Every allow policy must require phishing-resistant independent MFA for at most 30 minutes.');
  requireThat(!policy.session_duration||shortSession(policy.session_duration),'An Access policy session exceeds 30 minutes.');
 }
 requireThat(!organization.mfa_config?.amr_matching_session_duration||organization.mfa_config.amr_matching_session_duration==='0m','Disable IdP AMR matching to require the configured independent MFA.');
}
export async function preflight(config,environment=process.env,fetcher=fetch){
 requireThat(!environment.CF_PAGES,'Production Worker deployment is disabled in Cloudflare Pages.');
 const branch=environment.WORKERS_CI_BRANCH||environment.CF_PAGES_BRANCH||environment.GITHUB_REF_NAME;
 requireThat(branch==='main','Only an identified main branch may run the production deployment.');
 requireThat(config.name===WORKER&&config.workers_dev===false&&config.preview_urls===false,'Worker identity or alternate-hostname protection differs from the approved release.');
 requireThat(config.routes?.length===1&&config.routes[0].pattern===HOST&&config.routes[0].custom_domain===true,'Unexpected production domain routing.');
 const token=environment.CLOUDFLARE_SECURITY_READ_TOKEN;
 requireThat(!!token,'Set CLOUDFLARE_SECURITY_READ_TOKEN as a private build secret with read-only Access, Workers, Turnstile, and R2 permissions.');
 async function get(path){const response=await fetcher('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});const data=await response.json();requireThat(response.ok&&data.success===true,'Cloudflare security preflight could not read '+path+'. Verify read permissions.');requireThat(!data.result_info?.total_pages||data.result_info.total_pages===1,'Paginated Cloudflare policy response needs explicit review; release blocked.');return data.result}
 const settings=await get('/workers/scripts/'+WORKER+'/settings'),bindings=settings.bindings||[];
 const binding=name=>bindings.find(b=>b.name===name),value=name=>binding(name)?.text;
 for(const name of ['ADMIN_ACCESS_TEAM_DOMAIN','ADMIN_ACCESS_AUD','ADMIN_ACCESS_APP_ID','TURNSTILE_SITE_KEY'])requireThat(typeof value(name)==='string'&&value(name).length>0,'Set '+name+' as a runtime text variable before deployment.');
 requireThat(/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(value('ADMIN_ACCESS_TEAM_DOMAIN')),'Invalid Access team domain.');
 requireThat(/^[a-f0-9-]{36}$/i.test(value('ADMIN_ACCESS_APP_ID')),'Invalid Access application ID.');
 requireThat(/^[a-zA-Z0-9_-]{10,100}$/.test(value('TURNSTILE_SITE_KEY')),'Invalid Turnstile site key.');
 requireThat(binding('TURNSTILE_SECRET_KEY')?.type==='secret_text','TURNSTILE_SECRET_KEY must be a Worker runtime secret.');
 requireThat(binding('DB')?.id==='ed7e63c8-77fd-4314-ab35-131c061e016a'&&binding('BUCKET')?.bucket_name==='iyaayasfw-supply-images','Runtime storage bindings differ from the established production resources.');
 requireThat(!!binding('OWNER_EMAIL'),'The existing runtime OWNER_EMAIL must be retained.');
 requireThat(!binding('BOOTSTRAP_PASSWORD'),'Remove the runtime bootstrap password after initial account activation.');
 const [app,policies,organization,widget,publicBucket,domains]=await Promise.all([
  get('/access/apps/'+value('ADMIN_ACCESS_APP_ID')),get('/access/apps/'+value('ADMIN_ACCESS_APP_ID')+'/policies'),get('/access/organizations'),get('/challenges/widgets/'+value('TURNSTILE_SITE_KEY')),get('/r2/buckets/iyaayasfw-supply-images/domains/managed'),get('/r2/buckets/iyaayasfw-supply-images/domains/custom')]);
 validateAccess(app,policies,organization,value('ADMIN_ACCESS_AUD'),value('ADMIN_ACCESS_TEAM_DOMAIN'));
 requireThat(widget.mode==='managed'&&widget.domains?.length===1&&widget.domains[0]===HOST,'Use a managed Turnstile widget restricted to iyaayasfw.com.');
 requireThat(publicBucket.enabled===false&&Array.isArray(domains.domains)&&domains.domains.every(d=>d.enabled===false),'Product image bucket must have public managed and custom domains disabled.');
 for(const name of ['ADMIN_ACCESS_TEAM_DOMAIN','ADMIN_ACCESS_AUD','ADMIN_ACCESS_APP_ID','TURNSTILE_SITE_KEY'])requireThat(!Object.hasOwn(config.vars||{},name)||config.vars[name]===value(name),'Local configuration would override validated runtime '+name+'.');
 // Wrangler retains runtime text values and secrets. Do not copy retrieved
 // runtime values or build secrets into generated files.
 config.keep_vars=true;
 return {checked:['Access MFA and identity','Turnstile configuration','private R2','runtime configuration','main-only production routing']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const config=JSON.parse(readFileSync(process.argv[2]||'dist/server/wrangler.json','utf8'));console.log(JSON.stringify(await preflight(config),null,2))}catch(e){console.error('Security preflight blocked release: '+e.message);process.exitCode=1}}

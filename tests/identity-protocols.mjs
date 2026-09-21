import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,createHash,sign,randomBytes} from 'node:crypto';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import {fixture} from './identity-fixture.mjs';
const f=await fixture(),{db,sqlite}=f,C=await f.module('lib/identity/common'),F=await f.module('lib/identity/flows'),P=await f.module('lib/identity/providers');
sqlite.exec("INSERT INTO members(id,email,name,role) VALUES('member','member@example.test','Synthetic Member','member'),('other','other@example.test','Other Member','member')");
sqlite.exec(readFileSync('IDENTITY-SCHEMA.sql','utf8'));
const env={IDENTITY_ENABLED:'true',IDENTITY_BASE_DOMAIN:'identity.test',IDENTITY_GOOGLE_ENABLED:'true',IDENTITY_MICROSOFT_ENABLED:'true',IDENTITY_PASSKEY_ENABLED:'true',GOOGLE_CLIENT_ID:'synthetic-google-client',GOOGLE_CLIENT_SECRET:'synthetic-google-secret',MICROSOFT_CLIENT_ID:'synthetic-microsoft-client',MICROSOFT_CLIENT_SECRET:'synthetic-microsoft-secret'};
let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;};const rejects=async(fn,label)=>{await assert.rejects(fn,label);checks++;};
const browser=C.digest('synthetic-auth-browser'),destination=C.digest('synthetic-destination');
const signingKeys=await generateKeyPair('RS256',{extractable:true}),jwk=await exportJWK(signingKeys.publicKey);jwk.kid='synthetic-signing-key';jwk.alg='RS256';jwk.use='sig';
const originalFetch=globalThis.fetch;let claims={},provider='google',badSignature=false,requests=[];
globalThis.fetch=async(input,init)=>{
 const req=new Request(input,init),url=new URL(req.url);requests.push(url.origin+url.pathname);
 if(url.href==='https://www.googleapis.com/oauth2/v3/certs'||url.href==='https://login.microsoftonline.com/consumers/discovery/v2.0/keys')return Response.json({keys:[jwk]});
 if(url.href!=='https://oauth2.googleapis.com/token'&&url.href!=='https://login.microsoftonline.com/consumers/oauth2/v2.0/token')throw Error('Unexpected fixture network destination');
 const form=new URLSearchParams(await req.text());assert.equal(form.get('grant_type'),'authorization_code');assert.ok(form.get('code_verifier'));assert.equal(form.get('redirect_uri'),'https://auth.identity.test/oidc/'+provider+'/callback');
 const jwt=await new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:jwk.kid}).sign(signingKeys.privateKey);
 return Response.json({access_token:'synthetic-discarded-access-token',token_type:'Bearer',expires_in:3600,id_token:badSignature?jwt.slice(0,-5)+'AAAAA':jwt});
};
const begin=async(p='google')=>{
 provider=p;const fid=await F.newFlow(db,destination,'/'),flow=await F.adoptFlow(db,fid,browser,'auth');
 const start=new URL(await P.startProvider(db,env,flow,p,browser));
 check(start.searchParams.get('scope')==='openid email profile','minimal provider scopes');check(start.searchParams.get('code_challenge_method')==='S256','PKCE S256 required');
 claims={iss:P.ISSUERS[p],sub:'subject-'+p,aud:p==='google'?env.GOOGLE_CLIENT_ID:env.MICROSOFT_CLIENT_ID,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,nonce:start.searchParams.get('nonce'),email:'member@gmail.com',email_verified:true,...(p==='microsoft'?{tid:P.CONSUMER_TENANT,xms_edov:true}:{})};
 const callback=new URL('https://auth.identity.test/oidc/'+p+'/callback');callback.searchParams.set('state',start.searchParams.get('state'));callback.searchParams.set('code','synthetic-provider-code');if(p==='google')callback.searchParams.set('iss',P.ISSUERS.google);
 return{fid,start,callback};
};
try{
 for(const p of ['google','microsoft']){
  const {callback,fid}=await begin(p),result=await P.finishProvider(db,env,callback,p,browser);check(result.flowId===fid&&result.proof.subject==='subject-'+p,'maintained client verifies signed '+p+' ID token');
  if(p==='microsoft')check(result.proof.bootstrapEmail===null,'valid consumer token does not unlock automatic email bootstrap');
  await rejects(()=>P.finishProvider(db,env,callback,p,browser),'OIDC callback replay denied');
 }
 for(const [claim,value] of [['nonce','wrong-nonce'],['iss','https://evil.test'],['aud','other-client'],['exp',1]]){
  const {callback}=await begin();claims[claim]=value;await rejects(()=>P.finishProvider(db,env,callback,'google',browser),'invalid '+claim+' rejected by maintained client');
 }
 {const {callback}=await begin();badSignature=true;await rejects(()=>P.finishProvider(db,env,callback,'google',browser),'invalid signature denied');badSignature=false;}
 {const {callback}=await begin();await rejects(()=>P.finishProvider(db,env,callback,'google',C.digest('other-browser')),'OIDC browser mismatch denied');await P.finishProvider(db,env,callback,'google',browser);checks++;}
 {const {callback}=await begin('microsoft');claims.tid='organizational-tenant';await rejects(()=>P.finishProvider(db,env,callback,'microsoft',browser),'organizational Microsoft account denied');}
 const rejections=sqlite.prepare("SELECT detail FROM identity_audit WHERE event='provider_callback_rejected'").all().map(r=>JSON.parse(r.detail));
 check(rejections.length>=5&&rejections.every(r=>Object.keys(r).sort().join(',')==='category,fresh'),'provider rejection audit stores only fixed category and fresh flag');
 check(!JSON.stringify(rejections).match(/synthetic-provider-code|member@gmail|wrong-nonce|https:/),'provider diagnostic contains no code, claims, email or URL');
 check(P.providerErrorCategory({message:'private-error',code:'private-code',cause:{token:'secret'}})==='provider-verification','unknown errors cannot inject diagnostic content');
 const fid=await F.newFlow(db,destination,'/'),fresh={...await F.adoptFlow(db,fid,browser,'auth'),purpose:'fresh',member_id:'member'};
 await rejects(()=>P.startProvider(db,env,fresh,'google',browser),'enabled but unlinked Google cannot verify a fresh change');
 await rejects(()=>P.startPasskey(db,env,fresh,browser,false),'enabled but unlinked passkey cannot verify a fresh change');
 const insert=F.credentialInsert(db,'member',{kind:'google',issuer:P.ISSUERS.google,subject:'pre-existing-proof',clientId:env.GOOGLE_CLIENT_ID,email:null,tenant:null,objectId:null},'fixture');await insert.statement.run();
 sqlite.prepare('UPDATE identity_credentials SET created_at=? WHERE id=?').run(fresh.created_at-1,insert.credentialId);
 check((await C.freshMethods(db,env,fresh)).join(',')==='google','pre-existing active Google with current client is offered');
 check((await C.freshMethods(db,{...env,GOOGLE_CLIENT_ID:'changed-client'},fresh)).length===0,'old-client credential is not offered as proof');
 check((await C.freshMethods(db,{...env,IDENTITY_GOOGLE_ENABLED:'false'},fresh)).length===0,'disabled provider is not offered as proof');
 sqlite.prepare("UPDATE identity_credentials SET status='revoked' WHERE id=?").run(insert.credentialId);
 check((await C.freshMethods(db,env,fresh)).length===0,'revoked credential is not offered as proof');
 check(requests.every(url=>!url.includes('graph.microsoft.com')),'no Graph or profile API permission/request');
}finally{globalThis.fetch=originalFetch;}

// A synthetic authenticator signs real ES256 WebAuthn bytes. This proves server
// verification, not device/browser interoperability or real biometric interaction.
const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),publicJwk=keys.publicKey.export({format:'jwk'}),credentialBytes=randomBytes(32),credentialId=credentialBytes.toString('base64url');
const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(publicJwk.x,'base64url')],[-3,Buffer.from(publicJwk.y,'base64url')]]));
const sha=b=>createHash('sha256').update(b).digest(),b64=b=>Buffer.from(b).toString('base64url');
const handle=sqlite.prepare("SELECT user_handle FROM identity_state WHERE member_id='member'").get().user_handle;
const regBrowser=C.digest('synthetic-register-browser'),invite=C.random(),grant=C.id();
sqlite.prepare("INSERT INTO identity_grants(id,member_id,kind,purpose,token_hash,epoch,created_by,created_at,expires_at) VALUES(?,'member','invite','enroll',?,0,'fixture',?,?)").run(grant,C.digest(invite),Date.now(),Date.now()+86400000);
const regFlowId=await F.claimInvite(db,invite,regBrowser);await F.bridgeInvite(db,regFlowId,destination,null);let regFlow=await C.flow(db,regFlowId);
const registration=(challenge,origin='https://register.identity.test',flags=0x45)=>{
 const length=Buffer.alloc(2);length.writeUInt16BE(credentialBytes.length);
 const authData=Buffer.concat([sha('identity.test'),Buffer.from([flags]),Buffer.alloc(4),Buffer.alloc(16),length,Buffer.from(cose)]);
 // Insert credential ID between the length and COSE key.
 const correct=Buffer.concat([authData.subarray(0,55),credentialBytes,authData.subarray(55)]);
 return{id:credentialId,rawId:credentialId,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(JSON.stringify({type:'webauthn.create',challenge,origin,crossOrigin:false})),attestationObject:b64(isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',correct]]))),transports:['internal']}};
};
for(const [origin,flags] of [['https://admin.identity.test',0x45],['https://gear.identity.test',0x45],['https://register.identity.test',0x41]]){
 const r=await P.startPasskey(db,env,regFlow,regBrowser,true);await rejects(()=>P.finishPasskey(db,env,regFlow,r.ceremony,regBrowser,registration(r.options.challenge,origin,flags),true),'wrong registration origin or missing UV denied');
}
const options=await P.startPasskey(db,env,regFlow,regBrowser,true);check(options.options.authenticatorSelection.residentKey==='required'&&options.options.authenticatorSelection.userVerification==='required','discoverable UV-required enrollment');
const verified=await P.finishPasskey(db,env,regFlow,options.ceremony,regBrowser,registration(options.options.challenge),true);check(verified.proof.userHandle===handle,'opaque existing member handle used');
await F.storeEnrollmentProof(db,regFlow,verified.proof);const credential=await F.finishEnrollment(db,await C.flow(db,regFlowId),'Synthetic security key');check(credential.member_id==='member','verified passkey linked to invitation member');
await rejects(()=>P.finishPasskey(db,env,regFlow,options.ceremony,regBrowser,registration(options.options.challenge),true),'registration challenge replay denied');
const assertion=(challenge,{origin='https://auth.identity.test',rp='identity.test',flags=0x05,counter=0,userHandle=handle}={})=>{
 const count=Buffer.alloc(4);count.writeUInt32BE(counter);const authData=Buffer.concat([sha(rp),Buffer.from([flags]),count]);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge,origin,crossOrigin:false}));const signature=sign('sha256',Buffer.concat([authData,sha(client)]),keys.privateKey);
 return{id:credentialId,rawId:credentialId,type:'public-key',clientExtensionResults:{},response:{authenticatorData:b64(authData),clientDataJSON:b64(client),signature:b64(signature),userHandle:b64(Buffer.from(userHandle,'hex'))}};
};
const login=async()=>{const fid=await F.newFlow(db,destination,'/'),flow=await F.adoptFlow(db,fid,browser,'auth');const r=await P.startPasskey(db,env,flow,browser,false);return{flow,...r};};
for(const variation of [{origin:'https://register.identity.test'},{origin:'https://admin.identity.test'},{rp:'evil.test'},{flags:0x01},{userHandle:'bb'.repeat(32)}]){
 const r=await login();await rejects(()=>P.finishPasskey(db,env,r.flow,r.ceremony,browser,assertion(r.options.challenge,variation),false),'invalid assertion binding denied');
}
for(const counter of [0,0,1,2]){const r=await login(),result=await P.finishPasskey(db,env,r.flow,r.ceremony,browser,assertion(r.options.challenge,{counter}),false);check(result.credential.id===credential.id,'valid assertion accepted, including all-zero counter');await rejects(()=>P.finishPasskey(db,env,r.flow,r.ceremony,browser,assertion(r.options.challenge,{counter}),false),'assertion replay rejected');}
{const r=await login();await rejects(()=>P.finishPasskey(db,env,r.flow,r.ceremony,browser,assertion(r.options.challenge,{counter:1}),false),'nonzero counter rollback denied');check(sqlite.prepare("SELECT count(*) n FROM identity_audit WHERE event='passkey_counter_rejected'").get().n===1,'counter rejection is recorded without raw assertion');}
{const r=await login();sqlite.prepare("UPDATE identity_credentials SET status='revoked' WHERE id=?").run(credential.id);await rejects(()=>P.finishPasskey(db,env,r.flow,r.ceremony,browser,assertion(r.options.challenge,{counter:3}),false),'revoked credential denied');}
check(!JSON.stringify(sqlite.prepare('SELECT * FROM identity_credentials').all()).includes('PRIVATE KEY'),'only public WebAuthn key material is stored');
console.log(`${checks} signed OIDC and WebAuthn protocol checks passed using synthetic provider/authenticator fixtures. Real devices and providers remain separate gates.`);
sqlite.close();

import * as oidc from 'openid-client';
import {generateAuthenticationOptions,generateRegistrationOptions,verifyAuthenticationResponse,verifyRegistrationResponse,type AuthenticationResponseJSON,type RegistrationResponseJSON} from '@simplewebauthn/server';
import {config,fail,random,digest,sql,one,atomic,guard,flowGuard,member,all,matchEmail,audit,freshMethods,type IdentitySettings,type Method,type Flow,type Credential} from './common';

export const CONSUMER_TENANT='9188040d-6c67-4c5b-b112-36a304b66dad';
export const ISSUERS={google:'https://accounts.google.com',microsoft:`https://login.microsoftonline.com/${CONSUMER_TENANT}/v2.0`};
// Fixed, retrieved provider metadata. No user-controlled discovery or JWKS URL.
export function providerClient(env:IdentitySettings,provider:'google'|'microsoft'){
  const c=config(env);if(!c.methods[provider])fail('This sign-in method is not available yet.',503);
  const clientId=provider==='google'?env.GOOGLE_CLIENT_ID!:env.MICROSOFT_CLIENT_ID!;
  const secret=provider==='google'?env.GOOGLE_CLIENT_SECRET!:env.MICROSOFT_CLIENT_SECRET!;
  const metadata=provider==='google'?{issuer:ISSUERS.google,authorization_endpoint:'https://accounts.google.com/o/oauth2/v2/auth',token_endpoint:'https://oauth2.googleapis.com/token',jwks_uri:'https://www.googleapis.com/oauth2/v3/certs',authorization_response_iss_parameter_supported:true}:
    {issuer:ISSUERS.microsoft,authorization_endpoint:'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',token_endpoint:'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',jwks_uri:'https://login.microsoftonline.com/consumers/discovery/v2.0/keys'};
  const client=new oidc.Configuration(metadata,clientId,{client_secret:secret,id_token_signed_response_alg:'RS256'},oidc.ClientSecretPost(secret));
  client.timeout=10;oidc.enableNonRepudiationChecks(client);
  return{client,clientId,callback:c.auth+'/oidc/'+provider+'/callback'};
}
export type ProviderProof={kind:'google'|'microsoft';issuer:string;subject:string;clientId:string;email:string|null;bootstrapEmail:string|null;tenant:string|null;objectId:string|null;authTime:number};
// Called only with claims already validated by openid-client, never browser claims.
export function providerProof(provider:'google'|'microsoft',clientId:string,claims:Record<string,unknown>,fresh=false):ProviderProof{
  if(claims.iss!==ISSUERS[provider]||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255)fail();
  if(provider==='microsoft'&&claims.tid!==CONSUMER_TENANT)fail('Use a personal Microsoft account.',403);
  const email=typeof claims.email==='string'&&claims.email.length<=254?claims.email:null;
  const canonical=matchEmail(email),domain=canonical?.split('@')[1];
  const authoritative=provider==='google'&&claims.email_verified===true&&(domain==='gmail.com'||typeof claims.hd==='string'&&claims.hd.toLowerCase()===domain);
  const now=Date.now(),authTime=typeof claims.auth_time==='number'?claims.auth_time*1000:now;
  if(fresh&&(typeof claims.auth_time!=='number'||authTime>now+5000||authTime<now-300000))fail('Fresh authentication was not demonstrated. Use another existing method.',403);
  return{kind:provider,issuer:ISSUERS[provider],subject:claims.sub,clientId,email,bootstrapEmail:authoritative?canonical:null,tenant:provider==='microsoft'?CONSUMER_TENANT:null,objectId:typeof claims.oid==='string'&&claims.oid.length<=255?claims.oid:null,authTime};
}
type Ceremony={id_hash:string;flow_id:string;kind:string;browser_hash:string;secret:string|null;expires_at:number;used_at:number|null};
export async function saveCeremony(db:D1Database,f:Flow,kind:string,browser:string,secret:unknown,ttl:number){
  const token=random(),now=Date.now();
  await atomic(db,[flowGuard(db,f),sql(db,'UPDATE identity_ceremonies SET used_at=?,secret=NULL WHERE flow_id=? AND kind=? AND used_at IS NULL',now,f.id,kind),sql(db,'INSERT INTO identity_ceremonies(id_hash,flow_id,kind,browser_hash,secret,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',digest(token),f.id,kind,browser,JSON.stringify(secret),now,Math.min(f.expires_at,now+ttl))]);return token;
}
export async function consumeCeremony(db:D1Database,token:string,kind:string,browser:string){
  const row=await one<Ceremony>(db,'SELECT * FROM identity_ceremonies WHERE id_hash=? AND kind=? AND browser_hash=? AND used_at IS NULL AND expires_at>?',digest(token),kind,browser,Date.now());
  if(!row?.secret)fail('This sign-in request expired. Start again.',409);
  await atomic(db,[guard(db,'EXISTS(SELECT 1 FROM identity_ceremonies WHERE id_hash=? AND used_at IS NULL AND expires_at>?)',row!.id_hash,Date.now()),sql(db,'UPDATE identity_ceremonies SET used_at=?,secret=NULL WHERE id_hash=?',Date.now(),row!.id_hash)]);
  return{flowId:row!.flow_id,secret:JSON.parse(row!.secret!) as Record<string,string>};
}
export async function startProvider(db:D1Database,env:IdentitySettings,f:Flow,provider:'google'|'microsoft',browser:string){
  if(f.purpose==='fresh'&&!(await freshMethods(db,env,f)).includes(provider))fail('Verify with your existing password or an already linked method before adding this method.',403);
  const {client,callback}=providerClient(env,provider),verifier=oidc.randomPKCECodeVerifier(),nonce=oidc.randomNonce();
  const state=await saveCeremony(db,f,provider,browser,{verifier,nonce,fresh:f.purpose==='fresh'?'true':'false'},600000);
  // Google requires an explicit optional-claim request and enabled Session age
  // claims in Google Auth Platform. It does not support forcing Google reauth.
  // A returned timestamp must still pass the same five-minute server check.
  const freshOptions:Record<string,string>=provider==='google'?{prompt:'select_account',claims:JSON.stringify({id_token:{auth_time:{essential:true}}})}:{max_age:'0',prompt:'login'};
  const url=oidc.buildAuthorizationUrl(client,{redirect_uri:callback,scope:'openid email profile',response_type:'code',state,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',...(f.purpose==='fresh'?freshOptions:{prompt:'select_account'})});
  return url.href;
}
export async function finishProvider(db:D1Database,env:IdentitySettings,url:URL,provider:'google'|'microsoft',browser:string){
  const state=url.searchParams.get('state');if(!state||state.length>100)fail();
  const ceremony=await consumeCeremony(db,state!,provider,browser),{client,clientId,callback}=providerClient(env,provider);
  if(provider==='google'&&ceremony.secret.fresh==='true'&&env.IDENTITY_GOOGLE_FRESH_ENABLED!=='true')fail('Use your existing password, passkey, or Personal Microsoft to verify this account change.',403);
  if(url.origin+url.pathname!==callback)fail();
  const tokens=await oidc.authorizationCodeGrant(client,url,{expectedState:state!,expectedNonce:ceremony.secret.nonce,pkceCodeVerifier:ceremony.secret.verifier,idTokenExpected:true,...(ceremony.secret.fresh==='true'?{maxAge:300}:{})}).catch(async error=>{
    // One record per consumed, browser-bound ceremony. Only fixed categories;
    // never persist provider messages, claims, URLs, codes or error causes.
    const category=providerErrorCategory(error);
    await audit(db,'authentication-attempt','provider_callback_rejected',provider,{category,fresh:ceremony.secret.fresh==='true'}).run();
    if(ceremony.secret.fresh==='true'&&(category==='freshness-missing'||category==='token-time'))fail('This provider could not confirm a recent account verification. Start the account change again and use your existing password, passkey, or another linked method.',403);
    fail(`Provider sign-in could not be verified (${category}). Start again using an existing method.`,403);
  });
  const claims=tokens.claims();if(!claims)fail();
  return {flowId:ceremony.flowId,proof:providerProof(provider,clientId,claims!,ceremony.secret.fresh==='true')};
}
export function providerErrorCategory(error:unknown){
  if(error instanceof oidc.AuthorizationResponseError)return 'provider-declined';
  if(error instanceof oidc.ResponseBodyError)return error.error==='invalid_client'?'client-configuration':error.error==='invalid_grant'?'code-rejected':'token-response';
  if(error instanceof oidc.ClientError){
    if(error.code==='OAUTH_INVALID_RESPONSE'&&error.cause instanceof Error&&error.cause.message==='JWT "auth_time" (authentication time) claim missing')return 'freshness-missing';
    if(error.code==='OAUTH_TIMEOUT'||error.code==='OAUTH_ABORT')return 'provider-timeout';
    if(error.code==='OAUTH_JWT_TIMESTAMP_CHECK_FAILED')return 'token-time';
    if(error.code==='OAUTH_JWT_CLAIM_COMPARISON_FAILED')return 'token-claims';
    if(error.code==='OAUTH_INVALID_RESPONSE')return 'invalid-response';
  }
  return 'provider-verification';
}
export async function startPasskey(db:D1Database,env:IdentitySettings,f:Flow,browser:string,registration:boolean){
  const c=config(env);if(!c.methods.passkey)fail('Passkeys are not available yet.',503);
  if(f.purpose==='fresh'&&!(await freshMethods(db,env,f)).includes('passkey'))fail('Verify with your existing password or an already linked method before adding a passkey.',403);
  const m=registration?await member(db,f.member_id||''):null;
  const existing=m?await all<{credential_id:string}>(db,"SELECT credential_id FROM identity_credentials WHERE member_id=? AND kind='passkey'",m.id):[];
  const options=registration?await generateRegistrationOptions({rpID:c.domain,rpName:'IYAAYASFW Supply',userName:'Member '+m!.user_handle.slice(0,8),userDisplayName:m!.name,userID:new Uint8Array(Buffer.from(m!.user_handle,'hex')),attestationType:'none',authenticatorSelection:{residentKey:'required',userVerification:'required'},excludeCredentials:existing.map(v=>({id:v.credential_id})),timeout:300000}):await generateAuthenticationOptions({rpID:c.domain,userVerification:'required',timeout:300000});
  const ceremony=await saveCeremony(db,f,registration?'create':'get',browser,{challenge:options.challenge},300000);return{options,ceremony};
}
export type PasskeyProof={kind:'passkey';credentialId:string;publicKey:string;counter:number;userHandle:string;rpId:string;transports:string[];backedUp:boolean;deviceType:string;authTime:number};
export async function finishPasskey(db:D1Database,env:IdentitySettings,f:Flow,ceremonyToken:string,browser:string,response:RegistrationResponseJSON|AuthenticationResponseJSON,registration:boolean){
  const c=config(env);if(!c.methods.passkey)fail('Passkeys are not available yet.',503);
  const ceremony=await consumeCeremony(db,ceremonyToken,registration?'create':'get',browser);if(ceremony.flowId!==f.id)fail();
  if(registration){
    const m=await member(db,f.member_id||'');
    const result=await verifyRegistrationResponse({response:response as RegistrationResponseJSON,expectedChallenge:ceremony.secret.challenge,expectedOrigin:c.register,expectedRPID:c.domain,requireUserPresence:true,requireUserVerification:true});
    if(!result.verified)fail();const info=result.registrationInfo!;
    const proof:PasskeyProof={kind:'passkey',credentialId:info.credential.id,publicKey:Buffer.from(info.credential.publicKey).toString('base64url'),counter:info.credential.counter,userHandle:m.user_handle,rpId:c.domain,transports:info.credential.transports||[],backedUp:info.credentialBackedUp,deviceType:info.credentialDeviceType,authTime:Date.now()};return{proof,credential:null};
  }
  const assertion=response as AuthenticationResponseJSON;
  const credential=await one<Credential>(db,"SELECT * FROM identity_credentials WHERE credential_id=? AND kind='passkey' AND status='active' AND rp_id=?",assertion.id,c.domain);if(!credential)fail();
  // Discoverable authentication must bind the returned opaque user handle too.
  if(assertion.response.userHandle!==Buffer.from(credential!.user_handle!,'hex').toString('base64url'))fail();
  const result=await verifyAuthenticationResponse({response:assertion,expectedChallenge:ceremony.secret.challenge,expectedOrigin:c.auth,expectedRPID:c.domain,requireUserVerification:true,credential:{id:credential!.credential_id!,publicKey:new Uint8Array(Buffer.from(credential!.public_key!,'base64url')),counter:credential!.counter}}).catch(async error=>{
    // The library checks the counter before the signature. Record an untrusted
    // rejected attempt; do not infer cloning or automatically revoke a method.
    const counterRejected=error instanceof Error&&/^Response counter value \d+ was lower than expected \d+$/.test(error.message);
    await audit(db,'authentication-attempt',counterRejected?'passkey_counter_rejected':'passkey_assertion_rejected',credential!.member_id,{credentialId:credential!.id,verified:false}).run();
    fail('This passkey could not be verified. Try another linked method or contact Jake.',403);
  });
  if(!result.verified)fail();
  await atomic(db,[flowGuard(db,f),guard(db,"EXISTS(SELECT 1 FROM identity_credentials WHERE id=? AND status='active' AND counter=?)",credential!.id,credential!.counter),sql(db,'UPDATE identity_credentials SET counter=?,backed_up=?,device_type=?,last_used_at=? WHERE id=?',result.authenticationInfo.newCounter,result.authenticationInfo.credentialBackedUp?1:0,result.authenticationInfo.credentialDeviceType,Date.now(),credential!.id)]);
  return{proof:null,credential:credential!};
}

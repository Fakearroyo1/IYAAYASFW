import {RequestError} from './http';
type Config={TURNSTILE_SECRET_KEY?:string;TURNSTILE_SITE_KEY?:string};
export async function verifyChallenge(request:Request,body:Record<string,any>,config:Config){
 if(!config.TURNSTILE_SECRET_KEY||!config.TURNSTILE_SITE_KEY)throw new RequestError('Sign-in protection is not configured. Contact the store administrator.',503);
 const token=body.challengeToken;if(typeof token!=='string'||!token||token.length>2048)throw new RequestError('Complete the security check and try again.',403);
 let result:any;
 try{const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:config.TURNSTILE_SECRET_KEY,response:token,remoteip:request.headers.get('cf-connecting-ip')||undefined}),signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Challenge provider unavailable');result=await response.json()}catch{throw new RequestError('The security check is temporarily unavailable. Try again.',503)}
 if(result.success!==true||result.hostname!==new URL(request.url).hostname||result.action!=='account')throw new RequestError('The security check expired or was not accepted. Try again.',403);
}

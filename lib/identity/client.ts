// The CSRF value is bound to a host-only HttpOnly browser cookie and the current
// session. Fetch it immediately before a mutation; never persist bearer tokens.
export async function secureFetch(input:RequestInfo|URL,init?:RequestInit){
 if(!init?.method||['GET','HEAD'].includes(init.method.toUpperCase()))return fetch(input,init);
 const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,window.location.origin);
 if(target.origin!==window.location.origin)throw Error('Open the store and try again.');
 const response=await fetch('/identity/api',{cache:'no-store',signal:init.signal}),context=await response.json() as {enabled?:boolean;csrf?:string;error?:string};
 if(!response.ok)throw Error(context.error||'Sign-in protection is unavailable.');
 const headers=new Headers(init.headers);if(context.enabled&&context.csrf)headers.set('x-identity-csrf',context.csrf);
 return fetch(input,{...init,headers});
}

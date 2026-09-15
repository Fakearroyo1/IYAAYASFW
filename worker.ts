import handler from 'vinext/server/fetch-handler';
// This app uses explicit JSON APIs, not Server Actions. Keep the unused decoder
// unreachable and apply browser protections before entering the framework.
export default {
 async fetch(request:Request,env:unknown,ctx:ExecutionContext):Promise<Response>{
  const nonce=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
  const csp=["default-src 'self'",`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,"style-src 'self' 'unsafe-inline'","img-src 'self' data: blob:","font-src 'self'","connect-src 'self'","object-src 'none'","base-uri 'none'","form-action 'self'","frame-ancestors 'none'"].join('; ');
  const headers=new Headers(request.headers);
  // A caller-supplied CSP must never select the nonce used in our HTML.
  headers.delete('content-security-policy-report-only');headers.set('content-security-policy',csp);
  const path=new URL(request.url).pathname;
  // No product uses the framework image optimizer. Keep its remote-fetch and
  // optional format decoders outside this application's request surface.
  const imageOptimizer=/^\/(?:_next|_vinext)\/image\/?$/.test(path);
  const write=['/api/auth','/api/pilot','/api/product-images'].includes(path);
  let response:Response;
  const actionHeader=request.headers.has('next-action')||request.headers.has('x-rsc-action');
  if(request.method==='POST'&&actionHeader)response=new Response('Server Actions are not supported.',{status:405});
  else if(imageOptimizer)response=new Response('Not found.',{status:404});
  else if(!['GET','HEAD'].includes(request.method)&&!(request.method==='POST'&&write))response=new Response('Method not allowed.',{status:405,headers:{Allow:write?'GET, HEAD, POST':'GET, HEAD'}});
  else response=await handler.fetch(new Request(request,{headers}),env,ctx);
  const output=new Response(response.body,response);
  output.headers.set('Content-Security-Policy',csp);
  output.headers.set('X-Frame-Options','DENY');
  output.headers.set('X-Content-Type-Options','nosniff');
  output.headers.set('Referrer-Policy','same-origin');
  output.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
  output.headers.set('Strict-Transport-Security','max-age=31536000');
  output.headers.set('Cache-Control','private, no-store');
  return output;
 }
};

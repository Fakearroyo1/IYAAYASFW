export class RequestError extends Error {
 constructor(message:string,public status:number){super(message)}
}
// Count UTF-8 bytes as the stream arrives. Reject before buffering an oversized body.
export async function readJson(request:Request,maxBytes:number){
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new RequestError('JSON is required.',415);
 const declared=request.headers.get('content-length');
 if(declared&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw new RequestError('Request is too large.',413);
 if(!request.body)throw new RequestError('Invalid request.',400);
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;void reader.cancel('Request timed out.')},10000);let ended=false;
 try{
  while(true){const {done,value}=await reader.read();if(done){ended=true;if(timedOut)throw new RequestError('Request timed out.',408);break}size+=value.byteLength;if(size>maxBytes){void reader.cancel();throw new RequestError('Request is too large.',413)}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new RequestError('Invalid request.',400)}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new RequestError('Invalid request.',400);
  return value as Record<string,any>;
 }finally{clearTimeout(timeout);if(!ended)void reader.cancel();reader.releaseLock()}
}

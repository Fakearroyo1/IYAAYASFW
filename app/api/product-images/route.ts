import {env} from 'cloudflare:workers';
import {getUser} from '@/app/auth';
import {identity} from '@/lib/pilot/service';
export const dynamic='force-dynamic';
const json=(error:string,status:number)=>Response.json({error},{status});
export async function POST(request:Request){
 try{
  if(request.headers.get('origin')!==new URL(request.url).origin)return json('Open the store and try again.',403);
  if(!env.DB||!env.BUCKET)return json('Image storage is temporarily unavailable.',503);
  if((await identity(env.DB,await getUser()))?.role!=='admin')return json('Administrator access is required.',403);
  const reader=request.body?.getReader();if(!reader)return json('Choose an image.',400);
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>6*1024*1024){await reader.cancel();return json('Choose an image smaller than 5 MB.',413)}chunks.push(value)}
  const form=await new Response(new Blob(chunks as BlobPart[]),{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData();
  const file=form.get('image');if(!(file instanceof File)||!file.size||file.size>5*1024*1024)return json('Choose an image smaller than 5 MB.',400);
  const bytes=new Uint8Array(await file.arrayBuffer());
  const type=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71?'image/png':new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP'?'image/webp':null;
  if(!type)return json('Use a JPG, PNG, or WebP image.',400);
  const id=crypto.randomUUID();await env.BUCKET.put('products/'+id,bytes,{httpMetadata:{contentType:type}});
  return Response.json({image:'/api/product-images?id='+id});
 }catch(e){console.error('Image upload failed',String(e));return json('The image could not upload. Your product has not changed. Try again.',503)}
}
export async function GET(request:Request){
 try{
  if(!await getUser())return new Response(null,{status:401});
  const id=new URL(request.url).searchParams.get('id')||'';if(!/^[a-f0-9-]{36}$/.test(id))return new Response(null,{status:404});
  if(!env.BUCKET)return new Response(null,{status:503});
  const object=await env.BUCKET.get('products/'+id);if(!object)return new Response(null,{status:404});
  return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});
 }catch{return new Response(null,{status:503})}
}

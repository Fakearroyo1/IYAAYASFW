import {rateLimit} from '@/lib/auth/session';
import {env} from 'cloudflare:workers';
import {getUser} from '@/app/auth';
import {accessFor,canShop} from '@/lib/pilot/access';
import {identity} from '@/lib/pilot/service';
export const dynamic='force-dynamic';
const json=(error:string,status:number)=>Response.json({error},{status});
export async function POST(request:Request){
 try{
  if(request.headers.get('origin')!==new URL(request.url).origin)return json('Open the store and try again.',403);
  if(!env.DB||!env.BUCKET)return json('Image storage is temporarily unavailable.',503);
  const member=await identity(env.DB,await getUser());if(member?.role!=='admin')return json('Administrator access is required.',403);
  if(!await rateLimit(env.DB,'upload:'+member.id,10,60000))return json('Too many uploads. Try again in one minute.',429);
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
  const user=await getUser();if(!user)return new Response(null,{status:401});
  const id=new URL(request.url).searchParams.get('id')||'';if(!/^[a-f0-9-]{36}$/.test(id))return new Response(null,{status:404});
  if(!env.BUCKET||!env.DB)return new Response(null,{status:503});
  const member=await identity(env.DB,user);if(!member)return new Response(null,{status:403});
  if(member.role!=='admin'){const access=await accessFor(env.DB,member as any),path='/api/product-images?id='+id;const matches=await env.DB.prepare("SELECT p.category FROM products p LEFT JOIN product_details d ON d.product_id=p.id WHERE p.active=1 AND COALESCE(d.archived,0)=0 AND (p.image=? OR EXISTS(SELECT 1 FROM json_each(COALESCE(d.images,'[]')) WHERE value=?))").bind(path,path).all<{category:string}>();if(!matches.results.some(p=>canShop(member as any,access,p.category)))return new Response(null,{status:404})}
  const object=await env.BUCKET.get('products/'+id);if(!object)return new Response(null,{status:404});
  return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});
 }catch{return new Response(null,{status:503})}
}

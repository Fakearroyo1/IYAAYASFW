import {scrypt, randomBytes, timingSafeEqual, createHash} from 'node:crypto';
const OPTIONS={N:16384,r:8,p:5,maxmem:32*1024*1024};
export function digest(value:string){return createHash('sha256').update(value).digest('hex')}
export function same(a:string,b:string){return timingSafeEqual(Buffer.from(digest(a),'hex'),Buffer.from(digest(b),'hex'))}
export function validPassword(v:unknown):v is string{return typeof v==='string'&&v.length>=15&&v.length<=128}
function derive(password:string,salt:string):Promise<Buffer>{return new Promise((resolve,reject)=>scrypt(password,salt,32,OPTIONS,(error,key)=>error?reject(error):resolve(key)))}
export async function passwordHash(password:string){if(!validPassword(password))throw Error('Use a password between 15 and 128 characters.');const salt=randomBytes(16).toString('hex');return `scrypt$16384$8$5$${salt}$${(await derive(password,salt)).toString('hex')}`}
export async function passwordMatches(password:string,encoded:string){const parts=encoded.split('$');if(parts.length!==6||parts.slice(0,4).join('$')!=='scrypt$16384$8$5'||!/^[a-f0-9]{32}$/.test(parts[4])||!/^[a-f0-9]{64}$/.test(parts[5]))return false;return timingSafeEqual(await derive(password,parts[4]),Buffer.from(parts[5],'hex'))}
export const dummyHash='scrypt$16384$8$5$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';

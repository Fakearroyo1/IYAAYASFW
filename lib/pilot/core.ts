import {OWNER_EMAIL} from './owner';
export type DB=D1Database; export type Row=Record<string,any>;
export class PilotError extends Error{constructor(message:string,public status=400){super(message)}}
export function fail(m:string,s=400):never{throw new PilotError(m,s)}
export const int=(v:any,min=0,max=1000000)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail('Enter a valid whole-number amount.');return v as number};
export const str=(v:any,max=200)=>{if(typeof v!=='string'||v.length>max)fail('Enter valid text.');return v.trim()};
export const uid=()=>crypto.randomUUID();
export const ownerAccount=(m:Row)=>Boolean(OWNER_EMAIL)&&m.email.toLowerCase()===OWNER_EMAIL;
export const reqId=(v:any)=>{const s=str(v,40);if(!/^[0-9a-f-]{36}$/.test(s))fail('Invalid request identifier.');return s};
export const first=async(db:DB,sql:string,...v:any[])=>db.prepare(sql).bind(...v).first<Row>();
export const rows=async(db:DB,sql:string,...v:any[])=>(await db.prepare(sql).bind(...v).all<Row>()).results;
export const stmt=(db:DB,sql:string,...v:any[])=>db.prepare(sql).bind(...v);
export const audit=(db:DB,actor:string,kind:string,target:string,detail:any)=>stmt(db,'INSERT INTO audit(id,actor,kind,target,detail,created_at) VALUES(?,?,?,?,?,?)',uid(),actor,kind,target,JSON.stringify(detail),Date.now());
export const guard=(db:DB,condition:string,...values:any[])=>stmt(db,`INSERT INTO guards(id,valid) VALUES(?,CASE WHEN (${condition}) THEN 1 ELSE 0 END)`,uid(),...values);
export const hash=async(v:any)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))).map(x=>x.toString(16).padStart(2,'0')).join('');
export async function batchAtomic(db:DB,statements:D1PreparedStatement[]){try{return await db.batch([...statements,stmt(db,'DELETE FROM guards')])}catch(e){if(/constraint|unique/i.test(String(e)))fail('The record changed or this action was already recorded. Refresh and check before trying again.',409);throw e}}

// Revalidate the actual session inside a money/stock write transaction.
export function sessionGuard(db:DB,memberId:string,tokenHash?:string){return tokenHash?[guard(db,"EXISTS(SELECT 1 FROM auth_sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND m.id=? AND m.active=1 AND s.expires_at>? AND s.created_at>?-CASE WHEN m.role='admin' THEN 43200000 ELSE 2592000000 END)",tokenHash,memberId,Date.now(),Date.now())]:[]}

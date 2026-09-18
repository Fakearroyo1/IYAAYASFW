import {type DB,type Row,fail,str,reqId,first,stmt,guard,hash,batchAtomic,sessionGuard} from './core';
export const noteText=(v:unknown,max=1000,min=5)=>{const t=str(v,max);if(t.length<min||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(t))fail(`Enter a note of at least ${min} characters.`);return t};
export async function operation(db:DB,m:Row,b:Row,admin:boolean,tokenHash?:string){
 if(admin&&m.role!=='admin')fail('Verified administrator access is required.',403);
 const id=reqId(b.requestId),fingerprint=await hash({actor:m.id,body:{...b,password:undefined,code:undefined}}),prior=await first(db,'SELECT fingerprint FROM mutations WHERE id=?',id);
 if(prior&&prior.fingerprint!==fingerprint)fail('This action identifier was already used.',409);
 return {id,replayed:!!prior,commit:async(statements:D1PreparedStatement[])=>{
  try {await batchAtomic(db,[...sessionGuard(db,m.id,tokenHash,admin),guard(db,admin?"EXISTS(SELECT 1 FROM members WHERE id=? AND active=1 AND role='admin')":"EXISTS(SELECT 1 FROM members WHERE id=? AND active=1)",m.id),...statements,stmt(db,'INSERT INTO mutations(id,fingerprint) VALUES(?,?)',id,fingerprint)])}
  catch(e){if((await first(db,'SELECT fingerprint FROM mutations WHERE id=?',id))?.fingerprint!==fingerprint)throw e}
 }};
}

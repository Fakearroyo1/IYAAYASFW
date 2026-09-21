import {fail,id,sql,one,all,guard,atomic,audit,matchEmail,text,type IdentitySettings} from './common';
import {requireOwner,ownerGuard,type IdentityUser} from './sessions';
import {approval,payloadHash} from './manage';
type ImportRow={number:number;memberId:string;version:number;name:string;contact:string;active:number;grants:{provider:string;raw:string;match:string;create:boolean}[];changes:string[];errors:string[];status:'Update'|'Unchanged'|'Conflict'};
// Bounded RFC4180-style parser: quoted commas/newlines and doubled quotes are
// supported. Formula-leading text is rejected because this is an authority input.
export function parseRoster(input:string){
 if(input.length>65536)fail('Use a file smaller than 64 KB.',413);
 const records:string[][]=[];let row:string[]=[],value='',quoted=false,closed=false;
 for(let i=0;i<input.length;i++){
  const c=input[i];if(quoted){if(c==='"'){if(input[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;continue;}
  if(c==='"'&&!value&&!closed){quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){
   row.push(value);value='';closed=false;if(c!==','){if(c==='\r'&&input[i+1]==='\n')i++;if(row.some(v=>v))records.push(row);row=[];}continue;
  }
  if(closed)fail('Unexpected text after a quoted CSV cell.',400);value+=c;
 }
 if(quoted)fail('A quoted CSV cell was not closed.',400);
 if(value||row.length){row.push(value);records.push(row);}
 if(records.length<2||records.length>101)fail('Include a header and 1–100 member rows.',400);
 const headers=records.shift()!.map((v,i)=>(i===0?v.replace(/^\uFEFF/,''):v).trim());
 const allowed=['member_id','display_name','contact_email','google_bootstrap_email','microsoft_bootstrap_email','access_enabled'];
 if(headers.some(v=>!allowed.includes(v))||new Set(headers).size!==headers.length||!headers.includes('member_id'))fail('Use only the supplied roster columns, including member_id. Roles, passwords, balances, and unknown columns are rejected.',400);
 return records.map((values)=>{if(values.length!==headers.length)fail('Every row must have the same number of cells as the header.',400);if(values.some(v=>/^[=+@]/.test(v.trim())||v.length>254||v.includes('\0')))fail('A cell contains unsupported text.',400);return Object.fromEntries(headers.map((h,i)=>[h,values[i].trim()]));});
}
export async function previewImport(db:D1Database,env:IdentitySettings,user:IdentityUser|null,csv:string){
 const actor=await requireOwner(db,user,env),input=parseRoster(csv),rows:ImportRow[]=[],seen=new Set<string>(),grantsSeen=new Set<string>();
 for(let i=0;i<input.length;i++){
  const source=input[i],m=await one<{id:string;name:string;active:number;version:number;contact:string|null}>(db,'SELECT m.id,m.name,m.active,s.version,c.email contact FROM members m JOIN identity_state s ON s.member_id=m.id LEFT JOIN identity_contacts c ON c.member_id=m.id WHERE m.id=?',source.member_id);
  const row:ImportRow={number:i+1,memberId:source.member_id,version:m?.version??-1,name:source.display_name||m?.name||'',contact:source.contact_email||m?.contact||'',active:m?.active??0,grants:[],changes:[],errors:[],status:'Unchanged'};
  if(!m)row.errors.push('An explicit existing member ID is required. Approve a new member in Members first.');
  if(seen.has(source.member_id))row.errors.push('Duplicate member ID in this file.');seen.add(source.member_id);
  if(source.access_enabled){if(!['true','false','1','0'].includes(source.access_enabled))row.errors.push('access_enabled must be true/false or 1/0.');else row.active=['true','1'].includes(source.access_enabled)?1:0;}
  if(source.member_id===env.IDENTITY_OWNER_MEMBER_ID&&row.active===0)row.errors.push('The owner cannot be disabled.');
  if(row.name.length>100||!row.name)row.errors.push('A display name of 1–100 characters is required.');
  if(source.contact_email&&!matchEmail(source.contact_email))row.errors.push('Contact email needs review.');
  if(m&&row.name!==m.name)row.changes.push('Display name');if(source.contact_email&&source.contact_email!==m?.contact)row.changes.push('Contact address (no login authority)');if(m&&row.active!==m.active)row.changes.push(row.active?'Reactivate access (old authority stays revoked)':'Disable access and revoke sessions');
  for(const provider of ['google','microsoft']){
   const raw=source[provider+'_bootstrap_email'];if(!raw)continue;const match=matchEmail(raw);if(!match){row.errors.push(provider+' address needs review.');continue;}
   const key=provider+':'+match;if(grantsSeen.has(key))row.errors.push('Duplicate provider address in this file.');grantsSeen.add(key);
   const existing=await one<{member_id:string;status:string}>(db,"SELECT member_id,status FROM identity_grants WHERE kind='bootstrap' AND provider=? AND match_email=?",provider,match);
   if(existing&&existing.member_id!==row.memberId)row.errors.push(provider+' address is reserved for a different member.');
   const create=!existing;row.grants.push({provider,raw,match,create});if(create)row.changes.push('Create one-use '+provider+' grant');
   if(!row.active&&create)row.errors.push('Do not grant first-login authority to disabled access.');
  }
  row.status=row.errors.length?'Conflict':row.changes.length?'Update':'Unchanged';rows.push(row);
 }
 const batch=id(),hash=payloadHash(rows),now=Date.now();
 await atomic(db,[ownerGuard(db,actor,env),sql(db,'INSERT INTO identity_imports(id,actor,payload_hash,rows_json,created_at,expires_at) VALUES(?,?,?,?,?,?)',batch,actor.memberId,hash,JSON.stringify(rows),now,now+600000),audit(db,actor.memberId,'roster_preview',batch,{rows:rows.length})]);return{batch,hash,rows};
}
export async function commitImport(db:D1Database,env:IdentitySettings,user:IdentityUser|null,payload:Record<string,unknown>,grantId:string){
 const actor=await requireOwner(db,user,env),batch=text(payload.batch,80),hash=text(payload.hash,64);
 if(!Array.isArray(payload.rows)||payload.rows.length>100||!payload.rows.every(n=>Number.isInteger(n)&&n>0&&n<=100)||new Set(payload.rows).size!==payload.rows.length)fail('Select valid rows.',400);
 const stored=await one<{rows_json:string;payload_hash:string}>(db,'SELECT rows_json,payload_hash FROM identity_imports WHERE id=? AND actor=? AND expires_at>?',batch,actor.memberId,Date.now());if(!stored||stored.payload_hash!==hash)fail('Preview expired. Upload the file again.',409);
 const rows=JSON.parse(stored!.rows_json) as ImportRow[];
 await atomic(db,[ownerGuard(db,actor,env),...await approval(db,actor,grantId,'owner:'+payloadHash(payload))]);
 const results:{row:number;result:string}[]=[];
 for(const number of payload.rows as number[]){
  const row=rows.find(r=>r.number===number);if(!row||row.errors.length){results.push({row:number,result:'Conflict: excluded by preview'});continue;}
  if(await one(db,'SELECT 1 FROM identity_import_rows WHERE batch_id=? AND row_number=?',batch,number)){results.push({row:number,result:'Already applied'});continue;}
  const now=Date.now(),statements=[ownerGuard(db,actor,env),guard(db,"EXISTS(SELECT 1 FROM identity_grants WHERE id=? AND status='consumed' AND member_id=? AND source_session=? AND epoch=? AND expires_at>? AND proof_at>?)",grantId,actor.memberId,actor.tokenHash,actor.epoch,now,now-300000),guard(db,'EXISTS(SELECT 1 FROM identity_imports WHERE id=? AND payload_hash=? AND expires_at>?)',batch,hash,now),guard(db,'EXISTS(SELECT 1 FROM identity_state WHERE member_id=? AND version=?)',row.memberId,row.version),sql(db,'UPDATE members SET name=?,active=? WHERE id=?',row.name,row.active,row.memberId)];
  if(row.contact)statements.push(sql(db,'INSERT INTO identity_contacts(member_id,email,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET email=excluded.email,updated_at=excluded.updated_at,updated_by=excluded.updated_by',row.memberId,row.contact,now,actor.memberId));
  for(const g of row.grants.filter(g=>g.create))statements.push(sql(db,"INSERT INTO identity_grants(id,member_id,kind,purpose,provider,match_email,raw_email,epoch,created_by,created_at,expires_at) SELECT ?,member_id,'bootstrap','first-association',?,?,?,epoch,?,?,? FROM identity_state WHERE member_id=?",id(),g.provider,g.match,g.raw,actor.memberId,now,now+90*86400000,row.memberId));
  statements.push(sql(db,'UPDATE identity_state SET version=version+1 WHERE member_id=?',row.memberId),sql(db,'INSERT INTO identity_import_rows(batch_id,row_number,member_id,result,committed_at) VALUES(?,?,?,?,?)',batch,number,row.memberId,'applied',now),audit(db,actor.memberId,'roster_row_applied',row.memberId,{batch,row:number,changes:row.changes}));
  try{await atomic(db,statements);results.push({row:number,result:'Applied'});}catch{results.push({row:number,result:'Conflict: state changed; preview again'});}
 }
 return{results,applied:results.filter(r=>r.result==='Applied').length,alreadyApplied:results.filter(r=>r.result==='Already applied').length,conflicts:results.filter(r=>r.result.startsWith('Conflict')).length};
}

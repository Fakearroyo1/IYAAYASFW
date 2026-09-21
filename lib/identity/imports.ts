import {fail,id,sql,one,all,guard,atomic,audit,matchEmail,text,type IdentitySettings} from './common';
import {requireOwner,ownerGuard,type IdentityUser} from './sessions';
import {approval,payloadHash} from './manage';
import {TAB_HARD_LIMIT} from '../pilot/balances';
import {MAX_ROSTER_BYTES,MAX_ROSTER_ROWS,rosterHeaders,type ImportMode} from './roster-format';

type ImportRow={number:number;mode?:ImportMode;memberId:string;email?:string;version:number;name:string;contact:string;active:number;grants:{provider:string;raw:string;match:string;create:boolean}[];changes:string[];errors:string[];warnings?:string[];status:'Create'|'Update'|'Unchanged'|'Conflict'|'Exists'};
export function importMode(value:unknown):ImportMode {
 // Requests from an older open tab retain their existing-member-only contract.
 if(value===undefined||value==='update')return 'update';
 if(value==='create')return 'create';
 fail('Choose Import new members or Update existing members.',400);
}
// Bounded RFC4180 parser. A leading BOM is removed before processing quoted headers.
export function parseRoster(input:string,mode:ImportMode='update'){
 if(new TextEncoder().encode(input).length>MAX_ROSTER_BYTES)fail('Use a CSV file no larger than 64 KB.',413);
 input=input.replace(/^\uFEFF/,'');
 const records:string[][]=[];let row:string[]=[],value='',quoted=false,closed=false;
 for(let i=0;i<input.length;i++){
  const c=input[i];if(quoted){if(c==='"'){if(input[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;continue;}
  if(c==='"'&&!value&&!closed){quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){
   row.push(value);value='';closed=false;if(c!==','){if(c==='\r'&&input[i+1]==='\n')i++;if(row.some(v=>v.trim()))records.push(row);row=[];}continue;
  }
  if(closed||c==='"')fail('Unexpected quote or text after a quoted CSV cell. Save using CSV UTF-8.',400);value+=c;
 }
 if(quoted)fail('A quoted CSV cell was not closed.',400);
 if(value||row.length){row.push(value);if(row.some(v=>v.trim()))records.push(row);}
 if(records.length<2||records.length>MAX_ROSTER_ROWS+1)fail('Include a header and 1–100 member rows.',400);
 const headers=records.shift()!.map(v=>v.trim());
 const required=mode==='create'?['display_name','email','access_enabled']:['member_id'];
 if(headers.some(v=>!rosterHeaders(mode).includes(v))||new Set(headers).size!==headers.length||required.some(v=>!headers.includes(v)))fail('Use the '+(mode==='create'?'new-member':'existing-member')+' template. Required columns: '+required.join(', ')+'. Roles, passwords, balances, and unknown columns are rejected.',400);
 return records.map((values,index)=>{
  if(values.length!==headers.length)fail('Data row '+(index+1)+': the number of cells does not match the header. Check commas and quotes.',400);
  return Object.fromEntries(headers.map((h,i)=>[h,values[i].trim()]));
 });
}

async function storePreview(db:D1Database,env:IdentitySettings,actor:IdentityUser,rows:ImportRow[]){
 const batch=id(),hash=payloadHash(rows),now=Date.now();
 await atomic(db,[ownerGuard(db,actor,env),sql(db,'INSERT INTO identity_imports(id,actor,payload_hash,rows_json,created_at,expires_at) VALUES(?,?,?,?,?,?)',batch,actor.memberId,hash,JSON.stringify(rows),now,now+600000),audit(db,actor.memberId,'roster_preview',batch,{rows:rows.length,mode:rows[0]?.mode||'update'})]);
 return{batch,hash,rows};
}
export async function readImport(db:D1Database,env:IdentitySettings,user:IdentityUser|null,batch:string,hash:string){
 const actor=await requireOwner(db,user,env);
 const stored=await one<{rows_json:string;payload_hash:string;expires_at:number}>(db,'SELECT rows_json,payload_hash,expires_at FROM identity_imports WHERE id=? AND actor=?',batch,actor.memberId);
 if(!stored||stored.payload_hash!==hash)fail('Import not found. Upload the file again.',404);
 const rows=JSON.parse(stored!.rows_json) as ImportRow[];
 const applied=await all<{row_number:number;member_id:string}>(db,'SELECT row_number,member_id FROM identity_import_rows WHERE batch_id=? ORDER BY row_number',batch);
 return{batch,hash,rows,applied,expired:stored!.expires_at<=Date.now()};
}
export async function previewImport(db:D1Database,env:IdentitySettings,user:IdentityUser|null,csv:string,mode:ImportMode='update'){
 const actor=await requireOwner(db,user,env),input=parseRoster(csv,mode),rows:ImportRow[]=[];
 // File-wide collisions mark every affected row, not just the second occurrence.
 const counts=new Map<string,number>();
 const key=(field:string,value:string)=>field+':'+value.toLowerCase();
 for(const s of input)for(const field of mode==='create'?['email','google_bootstrap_email']:['member_id','google_bootstrap_email','microsoft_bootstrap_email']){
  if(s[field]){const k=key(field,field==='member_id'?s[field]:matchEmail(s[field])||s[field]);counts.set(k,(counts.get(k)||0)+1);}
 }
 for(let i=0;i<input.length;i++){
  const source=input[i];
  const m=mode==='update'?await one<{id:string;name:string;active:number;version:number;contact:string|null}>(db,'SELECT m.id,m.name,m.active,s.version,c.email contact FROM members m JOIN identity_state s ON s.member_id=m.id LEFT JOIN identity_contacts c ON c.member_id=m.id WHERE m.id=?',source.member_id):null;
  const row:ImportRow={number:i+1,mode,memberId:mode==='create'?id():source.member_id,email:mode==='create'?(matchEmail(source.email)||'').toLowerCase():undefined,version:m?.version??-1,name:source.display_name||m?.name||'',contact:source.contact_email||m?.contact||'',active:m?.active??0,grants:[],changes:[],errors:[],warnings:[],status:'Unchanged'};
  for(const [field,value] of Object.entries(source))if(value.length>254||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||/^[=+@-]/.test(value))row.errors.push(field+': unsupported text or more than 254 characters.');
  if(mode==='update'&&!m)row.errors.push('member_id: an existing member ID is required. Use Import new members to create an account.');
  const primary=mode==='create'?'email':'member_id',primaryValue=primary==='email'?row.email||source.email:source.member_id;
  if((counts.get(key(primary,primaryValue))||0)>1)row.errors.push(primary+': duplicate in this file.');
  if(source.access_enabled){const access=source.access_enabled.toLowerCase();if(!['true','false','1','0'].includes(access))row.errors.push('access_enabled: use TRUE/FALSE or 1/0.');else row.active=['true','1'].includes(access)?1:0;}
  else if(mode==='create')row.errors.push('access_enabled: choose TRUE or FALSE.');
  if(row.memberId===env.IDENTITY_OWNER_MEMBER_ID&&row.active===0)row.errors.push('The owner cannot be disabled.');
  if(row.name.length>(mode==='create'?80:100)||!row.name)row.errors.push('display_name: enter 1–'+(mode==='create'?80:100)+' characters.');
  if(source.contact_email&&!matchEmail(source.contact_email))row.errors.push('contact_email: enter a supported email address.');
  if(mode==='create'){
   if(!row.email||row.email.length>200)row.errors.push('email: enter a supported email address of at most 200 characters.');
   const existing=row.email?await one<{id:string;active:number}>(db,'SELECT id,active FROM members WHERE lower(email)=?',row.email):null;
   if(existing){row.status='Exists';row.changes.push('Already exists'+(existing.active?'':' (disabled)')+'; no changes will be made.');}
   else row.changes.push('Create ordinary member; '+(row.active?'access enabled':'access disabled')+'; $0 debt/credit; snacks and gear enabled; $30 tab limit; community posting enabled.');
   if(await one(db,'SELECT 1 FROM members WHERE lower(name)=lower(?)',row.name))row.warnings!.push('A member with this name already exists. Verify these are different people.');
   if(input.some((s,j)=>j!==i&&s.display_name?.toLowerCase()===row.name.toLowerCase()))row.warnings!.push('This name occurs more than once in the file. Verify each person.');
  }else{
   if(m&&row.name!==m.name)row.changes.push('Display name');
   if(source.contact_email&&source.contact_email!==m?.contact)row.changes.push('Contact address (no login authority)');
   if(m&&row.active!==m.active)row.changes.push(row.active?'Reactivate access (old authority stays revoked)':'Disable access and revoke sessions');
  }
  if(row.status==='Exists'){row.status=row.errors.length?'Conflict':'Exists';rows.push(row);continue;}
  for(const provider of mode==='create'?['google']:['google','microsoft']){
   const field=provider+'_bootstrap_email',raw=source[field];if(!raw)continue;
   const match=matchEmail(raw);if(!match){row.errors.push(field+': enter a supported email address.');continue;}
   if((counts.get(key(field,match))||0)>1)row.errors.push(field+': duplicate provider address in this file.');
   const existing=await all<{member_id:string;match_email:string;status:string}>(db,"SELECT member_id,match_email,status FROM identity_grants WHERE kind='bootstrap' AND provider=? AND lower(match_email)=lower(?)",provider,match);
   if(existing.some(g=>g.member_id!==row.memberId))row.errors.push(field+': address is reserved for another member.');
   // Also catch an identity linked through an invitation without a bootstrap grant.
   if(await one(db,'SELECT 1 FROM identity_credentials WHERE kind=? AND lower(observed_email)=lower(?) AND member_id<>?',provider,match,row.memberId))row.errors.push(field+': address appears on another member’s linked or revoked method. Review that member first.');
   const create=existing.length===0;row.grants.push({provider,raw,match,create});
   if(create)row.changes.push('Preauthorize one '+provider+' first sign-in');
   if(existing.some(g=>g.member_id===row.memberId&&g.match_email!==match))row.warnings!.push('Existing '+provider+' reservation spelling is preserved.');
   if(!row.active&&create)row.errors.push(field+': cannot preauthorize sign-in while access_enabled is FALSE.');
   if(provider==='google'&&create&&(env.IDENTITY_GOOGLE_BOOTSTRAP_ENABLED!=='true'||env.IDENTITY_GOOGLE_ENABLED!=='true'))row.warnings!.push('Google preauthorization will wait until Google sign-in and automatic association are enabled.');
   if(provider==='google'&&!match.endsWith('@gmail.com'))row.warnings!.push('Google must verify this as a managed Workspace address. Other Google-account email addresses require an invitation.');
  }
  row.status=row.errors.length?'Conflict':mode==='create'?'Create':row.changes.length?'Update':'Unchanged';rows.push(row);
 }
 return storePreview(db,env,actor,rows);
}

export async function commitImport(db:D1Database,env:IdentitySettings,user:IdentityUser|null,payload:Record<string,unknown>,grantId:string){
 const actor=await requireOwner(db,user,env),batch=text(payload.batch,80),hash=text(payload.hash,64);
 if(!Array.isArray(payload.rows)||!payload.rows.length||payload.rows.length>100||!payload.rows.every(n=>Number.isInteger(n)&&n>0&&n<=100)||new Set(payload.rows).size!==payload.rows.length)fail('Select valid rows.',400);
 const preview=await readImport(db,env,actor,batch,hash);if(preview.expired)fail('Preview expired. Upload the file again.',409);
 const rows=preview.rows,purpose='owner:'+payloadHash(payload);
 // A same-session retry may reuse this exact consumed approval while still fresh.
 const retry=await one(db,"SELECT 1 FROM identity_grants WHERE id=? AND kind='action' AND purpose=? AND status='consumed' AND member_id=? AND source_session=? AND epoch=? AND expires_at>? AND proof_at>? AND (proof_credential IS NULL OR EXISTS(SELECT 1 FROM identity_credentials WHERE id=proof_credential AND status='active'))",grantId,purpose,actor.memberId,actor.tokenHash,actor.epoch,Date.now(),Date.now()-300000);
 if(!retry)await atomic(db,[ownerGuard(db,actor,env),...await approval(db,actor,grantId,purpose)]);
 const results:{row:number;memberId:string;name:string;email:string;result:string}[]=[];
 for(const number of payload.rows as number[]){
  const row=rows.find(r=>r.number===number);
  const report=(result:string)=>results.push({row:number,memberId:row?.memberId||'',name:row?.name||'',email:row?.email||'',result});
  if(!row||row.errors.length||row.status==='Exists'){report('Conflict: excluded by preview');continue;}
  if(await one(db,'SELECT 1 FROM identity_import_rows WHERE batch_id=? AND row_number=?',batch,number)){report('Already applied');continue;}
  if(row.status==='Unchanged'){report('Unchanged');continue;}
  const now=Date.now(),statements=[ownerGuard(db,actor,env),guard(db,"EXISTS(SELECT 1 FROM identity_grants WHERE id=? AND kind='action' AND purpose=? AND status='consumed' AND member_id=? AND source_session=? AND epoch=? AND expires_at>? AND proof_at>? AND (proof_credential IS NULL OR EXISTS(SELECT 1 FROM identity_credentials WHERE id=proof_credential AND status='active')))",grantId,purpose,actor.memberId,actor.tokenHash,actor.epoch,now,now-300000),guard(db,'EXISTS(SELECT 1 FROM identity_imports WHERE id=? AND actor=? AND payload_hash=? AND expires_at>?)',batch,actor.memberId,hash,now)];
  if(row.mode==='create'){
   // Never upsert members: the unique check and every dependent insert share one transaction.
   statements.push(guard(db,'NOT EXISTS(SELECT 1 FROM members WHERE lower(email)=?)',row.email!),sql(db,"INSERT INTO members(id,email,name,role,debt,credit,tab_limit,due_since,active) VALUES(?,?,?,'member',0,0,?,NULL,?)",row.memberId,row.email!,row.name,TAB_HARD_LIMIT,row.active),sql(db,'INSERT INTO member_access(member_id,snacks,gear) VALUES(?,1,1)',row.memberId),sql(db,'INSERT INTO member_controls(member_id,tab_limit,posting_enabled) VALUES(?,?,1)',row.memberId,TAB_HARD_LIMIT));
   // The existing identity_member_created trigger supplies the WebAuthn handle.
   statements.push(guard(db,'EXISTS(SELECT 1 FROM identity_state WHERE member_id=?)',row.memberId));
  }else statements.push(guard(db,'EXISTS(SELECT 1 FROM identity_state WHERE member_id=? AND version=?)',row.memberId,row.version),sql(db,'UPDATE members SET name=?,active=? WHERE id=?',row.name,row.active,row.memberId));
  if(row.contact)statements.push(sql(db,'INSERT INTO identity_contacts(member_id,email,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET email=excluded.email,updated_at=excluded.updated_at,updated_by=excluded.updated_by',row.memberId,row.contact,now,actor.memberId));
  for(const g of row.grants.filter(g=>g.create))statements.push(guard(db,"NOT EXISTS(SELECT 1 FROM identity_grants WHERE kind='bootstrap' AND provider=? AND lower(match_email)=lower(?)) AND NOT EXISTS(SELECT 1 FROM identity_credentials WHERE kind=? AND lower(observed_email)=lower(?) AND member_id<>?)",g.provider,g.match,g.provider,g.match,row.memberId),sql(db,"INSERT INTO identity_grants(id,member_id,kind,purpose,provider,match_email,raw_email,epoch,created_by,created_at,expires_at) SELECT ?,member_id,'bootstrap','first-association',?,?,?,epoch,?,?,? FROM identity_state WHERE member_id=?",id(),g.provider,g.match,g.raw,actor.memberId,now,now+90*86400000,row.memberId));
  statements.push(sql(db,'UPDATE identity_state SET version=version+1 WHERE member_id=?',row.memberId),sql(db,'INSERT INTO identity_import_rows(batch_id,row_number,member_id,result,committed_at) VALUES(?,?,?,?,?)',batch,number,row.memberId,'applied',now),audit(db,actor.memberId,'roster_row_applied',row.memberId,{batch,row:number,mode:row.mode||'update',changes:row.changes}));
  try{await atomic(db,statements);report('Applied');}catch{
   // Another same-batch request may have committed this row while this request waited.
   if(await one(db,'SELECT 1 FROM identity_import_rows WHERE batch_id=? AND row_number=?',batch,number))report('Already applied');
   else report('Conflict: row was not applied; preview again');
  }
 }
 return{batch,hash,results,applied:results.filter(r=>r.result==='Applied').length,alreadyApplied:results.filter(r=>r.result==='Already applied').length,conflicts:results.filter(r=>r.result.startsWith('Conflict')).length};
}

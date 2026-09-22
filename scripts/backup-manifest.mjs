import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
export const sha256=data=>createHash('sha256').update(data).digest('hex');
export const identifier=name=>'"'+name.replaceAll('"','""')+'"';
const serialize=value=>JSON.stringify(value,(_key,v)=>typeof v==='bigint'?{$integer:String(v)}:v instanceof Uint8Array?{$bytes:Buffer.from(v).toString('base64')}:v);
// Views contain age-based reminders. Evaluate them at one recorded instant so
// restoring tomorrow cannot look like a changed payment or member record.
// Delegate date formatting to the same SQLite engine; only "now" is frozen.
const clocks=new WeakMap();
function manifestClock(db){
 if(clocks.has(db))return clocks.get(db);
 const builtin=new DatabaseSync(':memory:'),clock={now:null};
 for(const name of ['strftime','date','time','datetime','julianday','unixepoch'])db.function(name,{varargs:true},(...args)=>{
  if(clock.now!==null){const i=name==='strftime'?1:0;if(args.length===i)args.push(clock.now);else if(typeof args[i]==='string'&&args[i].toLowerCase()==='now')args[i]=clock.now;}
  return builtin.prepare('SELECT '+name+'('+args.map(()=>'?').join(',')+') value').get(...args).value;
 });
 clocks.set(db,clock);return clock;
}
export function withManifestClock(db,now,callback){const clock=manifestClock(db),prior=clock.now;clock.now=new Date(now).toISOString();try{return callback()}finally{clock.now=prior}}
export function restoreMemory(sql){
 const instructions=sql.replace(/'(?:''|[^'])*'/gs,"''").replace(/--[^\n]*/g,'');
 if(/\b(?:ATTACH|DETACH|VACUUM|load_extension)\b/i.test(instructions))throw Error('Backup contains an unexpected external-file operation.');
 const db=new DatabaseSync(':memory:',{allowExtension:false,enableForeignKeyConstraints:false});
 try{db.exec(sql);db.exec('PRAGMA foreign_keys=ON');if(db.prepare('PRAGMA integrity_check').all().some(r=>r.integrity_check!=='ok')||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Database integrity or foreign-key validation failed.');return db;}catch(e){db.close();throw e;}
}
export function databaseManifest(db,{now=Date.now()}={}){
 const clock=manifestClock(db),evaluatedAt=new Date(now).toISOString();clock.now=evaluatedAt;
 try{
 const schema=db.prepare("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all();
 const objects={};
 for(const {name,type} of schema.filter(x=>['table','view'].includes(x.type))){const stmt=db.prepare('SELECT * FROM '+identifier(name));stmt.setReadBigInts(true);const rows=stmt.all().map(serialize).sort();objects[name]={type,rows:rows.length,sha256:sha256(rows.join('\n'))};}
 const members=db.prepare('SELECT id,role,active,debt,credit FROM members ORDER BY id').all();
 return {evaluatedAt,schemaHash:sha256(serialize(schema)),schema,objects,memberStateHash:sha256(serialize(members)),financialTotals:db.prepare('SELECT count(*) members,coalesce(sum(debt),0) debt,coalesce(sum(credit),0) credit FROM members').get()};
 }finally{clock.now=null;}
}
export function compareManifests(a,b,{schema=true}={}){
 const changed=Object.keys(a.objects).filter(name=>!b.objects[name]||JSON.stringify(a.objects[name])!==JSON.stringify(b.objects[name]));
 if(schema&&(a.schemaHash!==b.schemaHash||Object.keys(a.objects).length!==Object.keys(b.objects).length))changed.push('[schema]');
 return changed;
}

// Local synthetic SQLite only. Production modules are compiled unchanged;
// hooks control transaction ordering without adding production test bypasses.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export async function fixture({workflow=true}={}) {
  const out = resolve('.sites-runtime/identity-tests-'+process.pid);
  mkdirSync(out, {recursive:true});
  globalThis.__identityTestEnv = {OWNER_EMAIL:'owner@example.test'};
  writeFileSync(resolve(out,'env.mjs'), 'export const env=globalThis.__identityTestEnv;');
  const files = readdirSync('lib',{recursive:true}).filter(p=>p.endsWith('.ts')).map(p=>'lib/'+p);
  files.push('app/api/auth/route.ts');
  for (const file of readdirSync('lib',{recursive:true}).filter(p=>p.endsWith('.json'))) {
    const dest=resolve(out,'lib',file+'.mjs'); mkdirSync(dirname(dest),{recursive:true});
    writeFileSync(dest,'export default '+readFileSync(resolve('lib',file),'utf8')+';');
  }
  for (const file of files) {
    const dest=resolve(out,file.replace(/\.ts$/,'.mjs'));
    mkdirSync(dirname(dest),{recursive:true});
    const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
      .replace(/(from\s*|import\s*\()(['"])([^'"]+)\2/g, (all, prefix, quote, name) => {
        let target;
        if(name==='cloudflare:workers') target=resolve(out,'env.mjs');
        else if(name.startsWith('@/')) target=resolve(out,name.slice(2)+'.mjs');
        else if(name.startsWith('.')) target=resolve(dirname(dest),name+'.mjs');
        return target ? prefix+quote+pathToFileURL(target).href+quote : all;
      });
    writeFileSync(dest,code);
  }
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync('drizzle').filter(p=>p.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
  for(const file of ['AUTH','PRODUCT','SECURITY','BETA','ROUNDS','GUEST','AUTOPILOT','REWARDS','EARNING','REDEMPTION','PROFILE-EXPERIENCE','ADMIN-EXPERIENCE','WORKFLOW']) if(file!=='WORKFLOW'||workflow)sqlite.exec(readFileSync(file+'-SCHEMA.sql','utf8'));
  const hooks={beforeBatch:null,afterFirst:null};
  class Statement {
    constructor(sql,values=[]){this.sql=sql;this.values=values;}
    bind(...values){return new Statement(this.sql,values);}
    async first(column){const row=sqlite.prepare(this.sql).get(...this.values)||null;if(hooks.afterFirst)await hooks.afterFirst(this.sql,row);return column?row?.[column]??null:row;}
    async all(){return{results:sqlite.prepare(this.sql).all(...this.values),success:true};}
    async run(){const result=sqlite.prepare(this.sql).run(...this.values);return {success:true,meta:{changes:Number(result.changes)}};}
  }
  const db={prepare:sql=>new Statement(sql),exec:async sql=>sqlite.exec(sql),batch:async statements=>{
    if(hooks.beforeBatch){const hook=hooks.beforeBatch;hooks.beforeBatch=null;await hook(statements);}
    sqlite.exec('BEGIN');try{const results=[];for(const stmt of statements){const r=sqlite.prepare(stmt.sql).run(...stmt.values);results.push({success:true,meta:{changes:Number(r.changes)}});}sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}
  }};
  globalThis.__identityTestEnv.DB=db;
  const module=path=>import(pathToFileURL(resolve(out,path+'.mjs')).href);
  return{db,sqlite,hooks,module,env:globalThis.__identityTestEnv};
}

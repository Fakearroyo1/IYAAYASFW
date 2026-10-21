// On-demand encrypted D1 export. Never modifies the remote database.
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {encryptBackup} from './backup-crypto.mjs';
import {privateTemporaryDirectory,cloudflareRead} from './backup-private.mjs';
import {restoreMemory,databaseManifest,compareManifests} from './backup-manifest.mjs';
const output=process.argv[2];if(!output||!output.endsWith('.encrypted'))throw Error('Provide a private output path ending in .encrypted.');
// Validate key before making an API request.
encryptBackup(Buffer.alloc(0),process.env.BACKUP_ENCRYPTION_KEY);
const temp=privateTemporaryDirectory(),directory=temp.directory,startedAt=new Date().toISOString();
try{
 const config={name:'iyaayasfw-backup',account_id:'60bbba10092a452ee58b3bff5c92a894',d1_databases:[{binding:'DB',database_name:'iyaayasfw-supply-db',database_id:'ed7e63c8-77fd-4314-ab35-131c061e016a'}]};
 const configPath=join(directory,'wrangler.json');writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
 const exports=[],evaluationTime=Date.now();
 for(let pass=0;pass<2;pass++){
  const sqlPath=join(directory,'database-'+pass+'.sql');
  cloudflareRead(['d1','export','iyaayasfw-supply-db','--remote','--config',configPath,'--output',sqlPath]);
  const sql=readFileSync(sqlPath,'utf8'),db=restoreMemory(sql);
  try{exports.push({sql,manifest:databaseManifest(db,{now:evaluationTime})});}finally{db.close();}
 }
 const changed=compareManifests(exports[0].manifest,exports[1].manifest);
 if(changed.length)throw Error('The database changed between snapshots. Retry during a quiet interval; no reconciled backup was accepted.');
 const bundle={format:'iyaayasfw-d1-v2',startedAt,finishedAt:new Date().toISOString(),source:'iyaayasfw-supply-db',consistency:'Two consecutive full exports have identical application schema and every table/view digest.',sql:exports[0].sql,manifest:exports[0].manifest};
 writeFileSync(resolve(output),encryptBackup(Buffer.from(JSON.stringify(bundle)),process.env.BACKUP_ENCRYPTION_KEY),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({encryptedDatabaseBackup:'created',tables:Object.values(bundle.manifest.objects).filter(x=>x.type==='table').length,views:Object.values(bundle.manifest.objects).filter(x=>x.type==='view').length,consecutiveSnapshots:'identical',startedAt,finishedAt:bundle.finishedAt}));
}finally{temp.remove();}

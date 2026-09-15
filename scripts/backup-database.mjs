// On-demand encrypted D1 export. Never modifies the remote database.
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encryptBackup} from './backup-crypto.mjs';
const output=process.argv[2];if(!output||!output.endsWith('.encrypted'))throw Error('Provide a private output path ending in .encrypted.');
// Validate key before making an API request.
encryptBackup(Buffer.alloc(0),process.env.BACKUP_ENCRYPTION_KEY);
const directory=mkdtempSync(join(tmpdir(),'iyaayasfw-backup-'));chmodSync(directory,0o700);
try{
 const config={name:'iyaayasfw-backup',account_id:'60bbba10092a452ee58b3bff5c92a894',d1_databases:[{binding:'DB',database_name:'iyaayasfw-supply-db',database_id:'ed7e63c8-77fd-4314-ab35-131c061e016a'}]};
 const configPath=join(directory,'wrangler.json'),sql=join(directory,'database.sql');writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
 const wrangler=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
 const result=spawnSync(process.execPath,[wrangler,'d1','export','iyaayasfw-supply-db','--remote','--config',configPath,'--output',sql],{stdio:'pipe',env:process.env});
 if(result.error||result.status!==0)throw Error('Database export failed. Verify the scoped read token and account access.');
 writeFileSync(resolve(output),encryptBackup(readFileSync(sql),process.env.BACKUP_ENCRYPTION_KEY),{mode:0o600,flag:'wx'});
 console.log('Encrypted database backup created. Keep its key separately and run the isolated verification.');
}finally{rmSync(directory,{recursive:true,force:true})}

import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const id=process.env.CLOUDFLARE_D1_DATABASE_ID;
if(!id||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw Error('Set CLOUDFLARE_D1_DATABASE_ID in private build variables.');
const configPath='dist/server/wrangler.json';
const config=JSON.parse(readFileSync(configPath,'utf8'));
config.d1_databases.find(d=>d.binding==='DB').database_id=id;
writeFileSync(configPath,JSON.stringify(config));
const wrangler=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
for(const args of [ ['d1','execute','iyaayasfw-supply-db','--remote','--file','AUTH-SCHEMA.sql','--config',configPath], ['deploy','--config',configPath] ]){
 const result=spawnSync(process.execPath,[wrangler,...args],{stdio:'inherit',env:{...process.env,CI:'true'}});
 if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
}

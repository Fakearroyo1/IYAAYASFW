// Downloads only the established private bucket; object bytes remain in memory.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {encryptBackup} from './backup-crypto.mjs';
import {cloudflareRead} from './backup-private.mjs';
import {sha256} from './backup-manifest.mjs';
const [inventoryPath,output]=process.argv.slice(2);
if(!output?.endsWith('.encrypted'))throw Error('Provide an inventory and private .encrypted output path.');
encryptBackup(Buffer.alloc(0),process.env.BACKUP_ENCRYPTION_KEY);
const inventory=JSON.parse(readFileSync(inventoryPath,'utf8')),objects=[];
if(!Array.isArray(inventory.objects)||inventory.objects.length>10000)throw Error('Invalid complete inventory.');
for(const meta of inventory.objects){
 if(typeof meta.key!=='string'||meta.key.length>1024||!Number.isSafeInteger(meta.size)||meta.size<0||meta.size>32*1024*1024)throw Error('Object requires separately reviewed streaming backup.');
 const data=cloudflareRead(['r2','object','get','iyaayasfw-supply-images/'+meta.key,'--remote','--pipe'],34*1024*1024);
 if(data.length!==meta.size)throw Error('An object changed during backup. Refresh the inventory.');
 if(/^[a-f0-9]{1,32}$/i.test(meta.etag)&&createHash('md5').update(data).digest('hex')!==meta.etag.padStart(32,'0'))throw Error('Object checksum does not match inventory.');
 objects.push({...meta,sha256:sha256(data),data:data.toString('base64')});
}
writeFileSync(resolve(output),encryptBackup(Buffer.from(JSON.stringify({format:'iyaayasfw-r2-v1',inventoryAt:inventory.capturedAt,finishedAt:new Date().toISOString(),bucket:'iyaayasfw-supply-images',objects})),process.env.BACKUP_ENCRYPTION_KEY),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({encryptedAssetsBackup:'created',objects:objects.length,bytes:objects.reduce((n,x)=>n+x.size,0),postInventoryCheck:'required'}));

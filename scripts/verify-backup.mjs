// Decrypt into memory and restore only into an isolated in-memory SQLite database.
// This command cannot select or overwrite a Cloudflare database.
import {readFileSync,writeFileSync} from 'node:fs';
import {decryptBackup} from './backup-crypto.mjs';
import {restoreMemory,databaseManifest,compareManifests,sha256} from './backup-manifest.mjs';
const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
const plaintext=decryptBackup(readFileSync(args[0]),process.env.BACKUP_ENCRYPTION_KEY).toString('utf8');
const bundle=JSON.parse(plaintext);if(bundle.format!=='iyaayasfw-d1-v2')throw Error('A full-manifest database backup is required.');
const db=restoreMemory(bundle.sql);try{
 const before=databaseManifest(db);if(compareManifests(bundle.manifest,before).length)throw Error('Restored database does not match its full manifest.');
 let priorBusinessState='not compared';
 if(option('--baseline')){
  const prior=JSON.parse(decryptBackup(readFileSync(option('--baseline')),process.env.BACKUP_ENCRYPTION_KEY).toString('utf8'));
  if(prior.format!=='iyaayasfw-d1-v2')throw Error('Invalid baseline backup format.');
  // These operational tables legitimately change during sign-in and cleanup.
  // Every other preexisting table/view, including members and all business
  // history, must match. A concurrent commerce write requires human review.
  const transient=new Set(['auth_sessions','auth_limits','auth_admin_access','guards']);
  const changed=compareManifests(prior.manifest,before,{schema:false}).filter(name=>!transient.has(name));
  if(changed.length)throw Error('Preexisting business-state reconciliation needs review: '+changed.join(', '));
  priorBusinessState='all preexisting non-session/rate-limit tables and views matched';
 }
 let assetCount=0,referenceCount=0;
 if(option('--assets')){
  const assets=JSON.parse(decryptBackup(readFileSync(option('--assets')),process.env.BACKUP_ENCRYPTION_KEY).toString('utf8'));
  if(assets.format!=='iyaayasfw-r2-v1')throw Error('Invalid asset archive.');
  const keys=new Set();for(const object of assets.objects){const restored=Buffer.from(object.data,'base64');if(keys.has(object.key)||restored.length!==object.size||sha256(restored)!==object.sha256)throw Error('Restored object failed reconciliation.');keys.add(object.key);}
  assetCount=keys.size;
  if(!option('--inventory'))throw Error('A fresh complete R2 inventory is required for live reconciliation.');
  const latest=JSON.parse(readFileSync(option('--inventory'),'utf8'));
  const normalize=objects=>JSON.stringify(objects.map(({key,size,etag,last_modified,http_metadata,custom_metadata})=>({key,size,etag,last_modified,http_metadata,custom_metadata})).sort((a,b)=>a.key.localeCompare(b.key)));
  if(normalize(latest.objects)!==normalize(assets.objects))throw Error('R2 changed during backup; repeat with a consistent inventory.');
  const refs=new Set();
  const productPaths=db.prepare("SELECT image FROM products WHERE image IS NOT NULL UNION SELECT value image FROM product_details,json_each(product_details.images)").all();
  for(const {image} of productPaths){if(image.startsWith('/api/product-images?id='))refs.add('products/'+new URL(image,'https://restore.invalid').searchParams.get('id'));}
  if(before.objects.profile_images)for(const {object_key} of db.prepare('SELECT object_key FROM profile_images').all())refs.add(object_key);
  for(const key of refs)if(!keys.has(key))throw Error('A database image reference is missing from the private asset backup.');
  referenceCount=refs.size;
 }
 let migration='not requested';
 if(args.includes('--rehearse-migration')){
  const schema=readFileSync(new URL('../IDENTITY-SCHEMA.sql',import.meta.url),'utf8');db.exec(schema);db.exec(schema);
  const after=databaseManifest(db);if(compareManifests(before,after,{schema:false}).length)throw Error('Additive migration changed an existing table or view.');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migration introduced a foreign-key violation.');
  // Rehearsal changes only memory: simulate containment and prove it survives export-independent state checks.
  const target=db.prepare("SELECT id FROM members WHERE role='member' ORDER BY id LIMIT 1").get();
  if(target){db.prepare('UPDATE members SET active=0 WHERE id=?').run(target.id);db.prepare('UPDATE members SET active=1 WHERE id=?').run(target.id);if(db.prepare('SELECT count(*) n FROM auth_setup WHERE member_id=?').get(target.id).n||db.prepare('SELECT count(*) n FROM auth_recovery WHERE member_id=?').get(target.id).n||db.prepare('SELECT count(*) n FROM auth_sessions WHERE member_id=?').get(target.id).n)throw Error('Restored containment left pending access.');}
  migration='repeat application preserves all prior tables/views; isolated containment revokes pending access';
 }
 const result={isolatedRestore:'passed',environment:'memory only, no server or remote writes',tables:Object.values(before.objects).filter(x=>x.type==='table').length,views:Object.values(before.objects).filter(x=>x.type==='view').length,allTableAndViewDigests:'matched',immutableMemberAndBalanceState:'matched',priorBusinessState,schemaAndForeignKeys:'passed',assets:assetCount,imageReferences:referenceCount,migration,verifiedAt:new Date().toISOString()};
 writeFileSync(args[0]+'.verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{db.close()}

// Decrypt into memory and restore only into an isolated in-memory SQLite database.
// This command cannot select or overwrite a Cloudflare database.
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {decryptBackup} from './backup-crypto.mjs';
const sql=decryptBackup(readFileSync(process.argv[2]),process.env.BACKUP_ENCRYPTION_KEY).toString('utf8');
if(/\b(?:ATTACH|DETACH|VACUUM\s+INTO)\b/i.test(sql))throw Error('Unexpected external-file operation in backup.');
const db=new DatabaseSync(':memory:');try{
 db.exec(sql);const integrity=db.prepare('PRAGMA integrity_check').all(),foreignKeys=db.prepare('PRAGMA foreign_key_check').all();
 if(integrity.some(r=>r.integrity_check!=='ok')||foreignKeys.length)throw Error('Backup did not pass database integrity checks.');
 const expected=['members','products','orders','order_items','payments','audit','auth_credentials'];
 const counts=Object.fromEntries(expected.map(table=>[table,db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count]));
 console.log(JSON.stringify({isolatedRestore:'passed',counts},null,2));
}finally{db.close()}

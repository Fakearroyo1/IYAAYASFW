import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {encryptBackup,decryptBackup} from '../scripts/backup-crypto.mjs';
import {fixture} from './identity-fixture.mjs';
import {rehearseStaleIdentity} from '../scripts/rehearse-stale-identity.mjs';
const key=randomBytes(32).toString('hex'),input=Buffer.from('synthetic recovery fixture');
const encrypted=encryptBackup(input,key);assert.deepEqual(decryptBackup(encrypted,key),input);
const damaged=Buffer.from(encrypted);damaged[damaged.length-1]^=1;assert.throws(()=>decryptBackup(damaged,key));assert.throws(()=>decryptBackup(encrypted,randomBytes(32).toString('hex')));assert.throws(()=>encryptBackup(input,'weak'));
console.log('4 encrypted-backup integrity checks passed.');
assert.throws(()=>rehearseStaleIdentity({prepare:()=>({all:()=>[{file:'synthetic-on-disk.db'}]})}),/in-memory/);
const f=await fixture();
try{
 f.sqlite.exec("INSERT INTO members(id,email,name,role,debt,credit) VALUES('restore-member','restore@example.test','Restore member','member',725,250)");
 f.sqlite.exec(readFileSync('IDENTITY-SCHEMA.sql','utf8'));
 const result=rehearseStaleIdentity(f.sqlite);assert.equal(result.result,'passed');
 assert.equal(f.sqlite.prepare("SELECT debt FROM members WHERE id='restore-member'").get().debt,725);
 assert.equal(f.sqlite.prepare("SELECT credit FROM members WHERE id='restore-member'").get().credit,250);
 console.log('Stale-identity restore containment and business preservation passed in isolated memory.');
}finally{f.sqlite.close();}

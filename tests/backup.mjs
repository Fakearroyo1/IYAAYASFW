import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {encryptBackup,decryptBackup} from '../scripts/backup-crypto.mjs';
const key=randomBytes(32).toString('hex'),input=Buffer.from('synthetic recovery fixture');
const encrypted=encryptBackup(input,key);assert.deepEqual(decryptBackup(encrypted,key),input);
const damaged=Buffer.from(encrypted);damaged[damaged.length-1]^=1;assert.throws(()=>decryptBackup(damaged,key));assert.throws(()=>decryptBackup(encrypted,randomBytes(32).toString('hex')));assert.throws(()=>encryptBackup(input,'weak'));
console.log('4 encrypted-backup integrity checks passed.');

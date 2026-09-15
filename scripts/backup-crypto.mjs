// Authenticated encryption for private offline backups. Key stays outside source,
// filenames, command arguments, logs, and the backup itself.
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
const header=Buffer.from('IYAAYASFW-BACKUP-1\n');
function key(value){if(!/^[a-f0-9]{64}$/i.test(value||''))throw Error('BACKUP_ENCRYPTION_KEY must be a privately stored 32-byte hex key.');return Buffer.from(value,'hex')}
export function encryptBackup(data,secret){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),iv);cipher.setAAD(header);const encrypted=Buffer.concat([cipher.update(data),cipher.final()]);return Buffer.concat([header,iv,cipher.getAuthTag(),encrypted])}
export function decryptBackup(data,secret){if(!data.subarray(0,header.length).equals(header)||data.length<header.length+28)throw Error('Invalid backup format.');const iv=data.subarray(header.length,header.length+12),tag=data.subarray(header.length+12,header.length+28),decipher=createDecipheriv('aes-256-gcm',key(secret),iv);decipher.setAAD(header);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(data.subarray(header.length+28)),decipher.final()])}

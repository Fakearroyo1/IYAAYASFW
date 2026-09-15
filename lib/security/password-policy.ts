import hashes from './common-password-hashes.json';
import {createHash} from 'node:crypto';
const blocked=new Set(hashes);
// Exact whole-password comparisons; never reject a strong passphrase just
// because it contains a dictionary word. Existing login hashes are unchanged.
export function newPasswordProblem(value:unknown,email=''){
 if(typeof value!=='string'||Array.from(value).length<15||value.length>128)return 'Use a password between 15 and 128 characters.';
 const normalized=value.toLowerCase(),base=email.toLowerCase().split('@')[0];
 const expected=new Set<string>();
 for(const word of ['iyaayasfw','iyaayasfwsupply','iyaayasfw-supply','unitgear','snackbar',base,email.toLowerCase()])if(word)for(const suffix of ['', '123','1234','12345','123456','123456789','2026','2026!','password','password123','password123!'])expected.add(word+suffix);
 const fingerprint=createHash('sha256').update(value).digest('hex');
 if(blocked.has(fingerprint)||expected.has(normalized)||new Set(value).size===1)return 'This password is commonly used or easy to guess. Choose a different passphrase or a password-manager suggestion.';
 return null;
}

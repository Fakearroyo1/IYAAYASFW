import {spawnSync} from 'node:child_process';
import {mkdtempSync,chmodSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
export function privateTemporaryDirectory(){
 const root=realpathSync(tmpdir()),directory=mkdtempSync(join(root,'iyaayasfw-backup-'));
 if(process.platform==='win32'){
  if(!process.env.IYAAYASFW_POWERSHELL)throw Error('Use backup-with-key.ps1 for private Windows backups.');
  const result=spawnSync(process.env.IYAAYASFW_POWERSHELL,['-NoProfile','-File',fileURLToPath(new URL('./private-directory.ps1',import.meta.url)),'-Directory',directory],{stdio:'pipe'});
  if(result.status!==0)throw Error('Private temporary-folder access could not be established. No records exported.');
 }else chmodSync(directory,0o700);
 return {directory,remove(){const resolved=realpathSync(directory);if(dirname(resolved)!==root||!basename(resolved).startsWith('iyaayasfw-backup-'))throw Error('Refusing cleanup outside the verified private temporary directory.');rmSync(resolved,{recursive:true,force:true});}};
}
export const wrangler=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
export function cloudflareRead(args,maxBuffer=64*1024*1024){
 const r=spawnSync(process.execPath,[wrangler,...args],{stdio:'pipe',maxBuffer,env:{...process.env,CI:'true'}});
 if(r.error||r.status!==0)throw Error('Cloudflare backup read failed. Check scoped account authorization. Private response suppressed.');
 return r.stdout;
}

// Reproducible workflow audit. Tests use isolated fixtures, never production.
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const groups={
  unit:['dependency-guards','auth-containment','identity','member-import','workflow','identity-protocols','identity-edge-cases','identity-release','pilot','beta','rounds-1-2','rounds-3-4','rounds-5-7','earning','redemptions','profiles-experience','admin-experience','payment-handoff','rewards-ui','ui-contracts','http-security','backup','image-parsers','shop-migration'],
  http:['workflow-http','workflow-audit-http','identity-http','shared-nat','experience-http','rounds-http','roadmap-http','auth-integration','security','hardening'],
  browser:['workflow-browser','workflow-audit-browser'],
};
const group=process.argv[2];
if(!groups[group])throw Error('Choose unit, http, or browser. Build the main Worker and gear test Worker before http/browser.');
const results=[];
for(const name of groups[group]){
  const started=Date.now();
  const exitCode=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['tests/'+name+'.mjs'],{stdio:'inherit',env:process.env});p.on('error',reject);p.on('exit',resolve)});
  results.push({suite:name,result:exitCode===0?'passed':'failed',exitCode,seconds:Math.round((Date.now()-started)/1000)});
  console.log(JSON.stringify(results.at(-1)));
}
const directory='.sites-runtime/workflow-audit';mkdirSync(directory,{recursive:true});
writeFileSync(directory+'/'+group+'.json',JSON.stringify({group,finishedAt:new Date().toISOString(),results},null,2)+'\n');
if(results.some(r=>r.result!=='passed'))process.exitCode=1;

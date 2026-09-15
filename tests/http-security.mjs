import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import ts from 'typescript';
const directory=new URL('../.sites-runtime/http-security/',import.meta.url);mkdirSync(directory,{recursive:true});
writeFileSync(new URL('http.mjs',directory),ts.transpileModule(readFileSync('lib/security/http.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const {readJson}=await import(new URL('http.mjs',directory));let assertions=0;
function check(v,message){assert.ok(v,message);assertions++}
let pulls=0,canceled=false;
const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(1024));},cancel(){canceled=true}});
const request=new Request('https://test.local',{method:'POST',headers:{'Content-Type':'application/json'},body:stream,duplex:'half'});
await assert.rejects(()=>readJson(request,2048),e=>e.status===413);assertions++;
check(pulls<=4&&canceled,'oversized stream is canceled after the first excess chunk');
let read=false;const declared=new Request('https://test.local',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':'99999'},body:new ReadableStream({pull(c){read=true;c.close()}}),duplex:'half'});
await assert.rejects(()=>readJson(declared,2048),e=>e.status===413);assertions++;
for(const type of ['text/plain','application/json-malicious','multipart/form-data']){await assert.rejects(()=>readJson(new Request('https://test.local',{method:'POST',headers:{'Content-Type':type},body:'{}'}),2048),e=>e.status===415);assertions++}
const utf8=new Request('https://test.local',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({x:'é'.repeat(1000)})});await assert.rejects(()=>readJson(utf8,1500),e=>e.status===413);assertions++;
const valid=await readJson(new Request('https://test.local',{method:'POST',headers:{'Content-Type':'Application/JSON; charset=utf-8'},body:'{"text":"hello"}'}),2048);check(valid.text==='hello','valid JSON still parses');
console.log(`PASS: ${assertions} bounded-body and content-type checks.`);

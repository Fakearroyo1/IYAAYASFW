import {realpathSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url),modulePath=require.resolve('image-size',{paths:[realpathSync('node_modules/vinext')]});
// Each malformed parser runs with an external deadline, so a regression cannot
// hang CI. These buffers are exercised only against the locally installed patch.
const child=`const {createRequire}=require('node:module');const mod=require(process.argv[1]);const imageSize=mod.imageSize||mod.default;const kind=process.argv[2];let b;
function box(type,payload=Buffer.alloc(0),length){const out=Buffer.alloc(8+payload.length);out.writeUInt32BE(length??out.length);out.write(type,4);payload.copy(out,8);return out}
if(kind==='icns'){b=Buffer.alloc(16);b.write('icns');b.writeUInt32BE(16,4);b.write('icp4',8)}
if(kind==='jxl')b=Buffer.concat([box('JXL ',Buffer.from([13,10,135,10])),box('ftyp',Buffer.from('jxl ')),box('jxlp',Buffer.alloc(4),0)]);
if(kind==='heif')b=Buffer.concat([box('ftyp',Buffer.from('heic')),box('meta',Buffer.concat([Buffer.alloc(4),box('iprp',box('ipco',box('ispe',Buffer.alloc(12),0)))]))]);
if(kind==='png'){b=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.write('IHDR',12);b.writeUInt32BE(2,16);b.writeUInt32BE(3,20);const size=imageSize(b);if(size.width!==2||size.height!==3)process.exit(2);process.exit(0)}
try{imageSize(b);process.exit(2)}catch{process.exit(0)}`;
for(const kind of ['icns','jxl','heif','png']){const result=spawnSync(process.execPath,['-e',child,modulePath,kind],{timeout:3000,encoding:'utf8'});assert.equal(result.status,0,kind+' rejects malformed input or reads valid PNG before deadline: '+result.error)}
console.log('4 image-parser regression checks passed.');

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const root=createRequire(import.meta.url);
// Exercise both affected build/lint dependency paths, not a standalone copy.
const vinext=createRequire(import.meta.resolve('vinext'));
const commonjs=createRequire(vinext.resolve('vite-plugin-commonjs'));
const dynamic=createRequire(commonjs.resolve('vite-plugin-dynamic-import'));
const lint=createRequire(root.resolve('eslint-config-next'));
const nextLint=createRequire(lint.resolve('@next/eslint-plugin-next'));
let checks=0;
for(const parent of [dynamic,nextLint]){
 const glob=createRequire(parent.resolve('fast-glob'));
 const match=createRequire(glob.resolve('micromatch'));
 const braces=match('braces');
 assert.equal(match('braces/package.json').version,'3.0.3');checks++;
 assert.deepEqual(braces.expand('shop/{snacks,gear}/{a,b}.png'),['shop/snacks/a.png','shop/snacks/b.png','shop/gear/a.png','shop/gear/b.png']);checks++;
 for(const input of ['{'.repeat(1024)+'a,b'+'}'.repeat(1024),'('.repeat(1024)+'a'+')'.repeat(1024)]){
  for(const fn of ['parse','compile','expand','stringify']){assert.throws(()=>braces[fn](input),/nesting exceeds the supported limit/);checks++;}
 }
 const ast={type:'root',nodes:[]};let leaf=ast;
 for(let n=0;n<1024;n++){const child={type:'brace',nodes:[]};leaf.nodes=[child];leaf=child;}
 for(const fn of ['compile','expand','stringify']){assert.throws(()=>braces[fn](ast),/nesting exceeds the supported limit/);checks++;}
 const cyclic={type:'root',nodes:[]};cyclic.nodes.push(cyclic);
 for(const fn of ['compile','expand','stringify']){assert.throws(()=>braces[fn](cyclic),/nesting exceeds the supported limit/);checks++;}
}
console.log(JSON.stringify({suite:'dependency-guards',checks,result:'passed',advisory:'GHSA-vfj7-8cjw-p6xm',mitigation:'checksum-pinned local bounded AST/parser patch'}));

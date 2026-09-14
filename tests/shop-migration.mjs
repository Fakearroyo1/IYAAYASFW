import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const migration=readFileSync('SHOP-READY.sql','utf8');
function database(stock=8, price=150){
 const db=new DatabaseSync(':memory:');
 for(const file of ['drizzle/0000_tiny_shape.sql','drizzle/0001_absent_guardsmen.sql','AUTH-SCHEMA.sql'])db.exec(readFileSync(file,'utf8'));
 db.exec("INSERT INTO settings(id,cashtag,cash_instructions) VALUES('main','Example','Use the cash box')");
 db.prepare("INSERT INTO products(id,name,category,price,tax_bp,stock,active) VALUES('drink','Drink','Drinks',?,0,?,1)").run(price,stock);
 return db;
}
const db=database();
const original=db.prepare('SELECT * FROM products').all();
db.exec(migration);
assert.equal(db.prepare('SELECT enabled FROM settings').get().enabled,1,'ready shop opens');
assert.deepEqual(db.prepare('SELECT * FROM products').all(),original,'prices and stock preserved');
assert.equal(db.prepare('SELECT cash_instructions FROM settings').get().cash_instructions,'Use the cash box');
db.exec(migration);
assert.equal(db.prepare('SELECT count(*) n FROM audit').get().n,1,'retry creates no duplicate audit');
db.exec('UPDATE settings SET enabled=0');
db.exec(migration);
assert.equal(db.prepare('SELECT enabled FROM settings').get().enabled,0,'subsequent deployment preserves deliberate pause');
for(const args of [[0,150],[8,null]]){
 const unready=database(...args);unready.exec(migration);
 assert.equal(unready.prepare('SELECT enabled FROM settings').get().enabled,0,'unready shop remains closed');
 unready.exec('UPDATE products SET price=150,stock=8');unready.exec(migration);
 assert.equal(unready.prepare('SELECT enabled FROM settings').get().enabled,0,'later stock changes do not silently open shop');
 unready.close();
}
db.close();
console.log('PASS: 9 migration checks; stock and payment settings preserved, retries never undo a pause.');

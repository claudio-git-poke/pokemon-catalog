import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {createLiveInvalidator} from '../src/lib/live-invalidation.ts'
test('realtime batches bursts, preserves changes during a request, pauses hidden tabs and cleans up',async()=>{
 let visible=true,calls=0,resolve,scheduled=null
 const live=createLiveInvalidator({visible:()=>visible,refresh:async()=>{calls++;await new Promise(r=>{resolve=r})},schedule:fn=>{const callback=()=>{scheduled=null;fn()};scheduled=callback;return callback},cancel:()=>{scheduled=null}})
 live.invalidate();const first=scheduled;live.invalidate();assert.equal(scheduled,first)
 scheduled=null;first();assert.equal(calls,1)
 live.invalidate();assert.equal(scheduled,null)
 resolve();await Promise.resolve();await Promise.resolve();assert.ok(scheduled)
 visible=false;scheduled();assert.equal(calls,1)
 visible=true;const pending=live.refresh();assert.equal(calls,2);resolve();await pending
 live.stop();live.invalidate();assert.equal(scheduled,null)
})
test('catalog changes emit only a small readable signal; public clients cannot forge it',async()=>{
 const pg=new PGlite()
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role;
  create table cards(id int);create table catalog_search_entries(id int);create table set_carte(id int);create table set_carte_immagini(id int);
  grant select,insert,update on cards to anon;`)
  const sql=await readFile(new URL('../db/catalog-live.sql',import.meta.url),'utf8')
  await pg.exec(sql.split('-- Publication configuration')[0])
  await pg.exec('set role anon;insert into cards values(1),(2)')
  const row=(await pg.query('select * from catalog_live_updates')).rows[0]
  assert.equal(Number(row.revision),1,'one signal per statement, not per row')
  assert.deepEqual(Object.keys(row).sort(),['revision','scope','updated_at'])
  await assert.rejects(pg.exec("update catalog_live_updates set revision=99"),/permission denied/)
  await pg.exec('reset role;insert into catalog_search_entries values(1);insert into set_carte values(1);insert into set_carte_immagini values(1)')
  assert.equal(Number((await pg.query('select revision from catalog_live_updates')).rows[0].revision),4)
 }finally{await pg.close()}
})

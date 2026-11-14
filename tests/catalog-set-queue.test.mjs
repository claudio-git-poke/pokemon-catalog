import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {postgresClient} from './helpers/postgres-client.mjs'
import {fairSetBatch,dueSetBatch} from '../scripts/catalog-set-queue.mjs'
test('first imports get priority without starving refreshes; spare capacity is reused',()=>{
 const a=Array.from({length:20},(_,i)=>'new'+i),b=Array.from({length:20},(_,i)=>'old'+i)
 assert.deepEqual(fairSetBatch(a,b,5),['new0','new1','new2','new3','old0'])
 assert.deepEqual(fairSetBatch(a,[],5),a.slice(0,5))
 assert.deepEqual(fairSetBatch([],b,5),b.slice(0,5))
})
test('source outages back off, success resets, data errors stay deferred and future sets remain excluded',async()=>{
 const pg=new PGlite()
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role;
  create table catalog_sync_sets(source_uid text primary key,provider text default 'tcgdex',set_id text,last_sync_at timestamptz,next_sync_at timestamptz,last_error text);
  insert into catalog_sync_sets values('old-error','tcgdex','a',null,now()+interval '24 hours','Error: HTTP 503');`)
  await pg.exec(await readFile(new URL('../db/catalog-sync-recovery.sql',import.meta.url),'utf8'))
  let row=(await pg.query("select * from catalog_sync_sets where source_uid='old-error'")).rows[0]
  assert.equal(row.sync_failures,1);assert.ok(Date.parse(row.next_sync_at)<Date.now()+20*60000)
  await pg.exec("update catalog_sync_sets set next_sync_at=now()+interval '24 hours',last_error='Error: HTTP 503' where source_uid='old-error'")
  row=(await pg.query("select * from catalog_sync_sets where source_uid='old-error'")).rows[0]
  assert.equal(row.sync_failures,2);assert.ok(Date.parse(row.next_sync_at)>=Date.now()+29*60000);assert.ok(Date.parse(row.next_sync_at)<Date.now()+35*60000)
  await pg.exec("update catalog_sync_sets set next_sync_at=now()+interval '7 days',last_error=null,last_sync_at=now() where source_uid='old-error'")
  assert.equal((await pg.query("select sync_failures from catalog_sync_sets where source_uid='old-error'")).rows[0].sync_failures,0)
  await pg.exec("insert into catalog_sync_sets(source_uid,set_id,next_sync_at,last_error) values('limited','b',now()+interval '24 hours','Error: HTTP 429'),('empty','c',now()+interval '24 hours','Set privo di carte')")
  const limited=(await pg.query("select * from catalog_sync_sets where source_uid='limited'")).rows[0]
  assert.ok(Date.parse(limited.next_sync_at)>Date.now()+59*60000)
  const empty=(await pg.query("select * from catalog_sync_sets where source_uid='empty'")).rows[0]
  assert.ok(Date.parse(empty.next_sync_at)>Date.now()+23*3600000)
  await pg.exec("insert into catalog_sync_sets(source_uid,set_id,next_sync_at,last_sync_at) values('new','n',now()-interval '1 hour',null),('refresh','r',now()-interval '2 hours',now()),('index','__index__',now()-interval '2 hours',null)")
  const due=await dueSetBatch({db:postgresClient(pg),provider:'tcgdex',at:new Date().toISOString(),limit:5})
  assert.deepEqual(due.map(r=>r.source_uid),['new','refresh'])
 }finally{await pg.close()}
})

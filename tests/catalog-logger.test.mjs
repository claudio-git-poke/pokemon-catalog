import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {postgresClient} from './helpers/postgres-client.mjs'
import {createCatalogLogger} from '../scripts/catalog-logger.mjs'
test('concurrent writers detach batches and persist every event exactly once',async()=>{
 const seen=new Set(),current=[]
 const db={from(table){return {
  async upsert(rows,options){assert.equal(options.onConflict,'run_id,event_key');assert.equal(options.ignoreDuplicates,true);await new Promise(r=>setTimeout(r,5));for(const row of rows){assert.ok(!seen.has(row.event_key));seen.add(row.event_key)}return {error:null}},
  update(row){return {async eq(){current.push(row.summary.current);return {error:null}}}}
 }}}
 const log=createCatalogLogger({db,runId:1,summary:{},output:()=>{}})
 await Promise.all(Array.from({length:90},(_,i)=>log(`Carta ${i}`,true)))
 assert.equal(seen.size,90);assert.equal(current.at(-1),'Carta 89')
})
test('incremental log retains every event beyond 2000 and legacy updates do not duplicate events',async()=>{
 const pg=new PGlite()
 try{
  await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;create table catalog_sync_runs(id bigint primary key,summary jsonb);insert into catalog_sync_runs values(1,\'{}\'),(2,\'{}\');')
  await pg.exec(await readFile(new URL('../db/log-events.sql',import.meta.url),'utf8'))
  let clock=Date.parse('2026-01-01T00:00:00Z')
  const log=createCatalogLogger({db:postgresClient(pg),runId:1,summary:{added:3},clock:()=>clock++,output:()=>{}})
  for(let i=0;i<2100;i++)await log(`Carta ${i}`)
  await log('Fine',true)
  assert.equal((await pg.query('select count(*)::int n from catalog_sync_events where run_id=1')).rows[0].n,2101)
  const summary=(await pg.query('select summary from catalog_sync_runs where id=1')).rows[0].summary
  assert.equal(summary.events,undefined);assert.equal(summary.current,'Fine');assert.equal(summary.logger_version,3)
  // Simulate a transport replay after the first database write already succeeded.
  const realDb=postgresClient(pg)
  const replayDb={from(table){if(table!=='catalog_sync_events')return realDb.from(table);return {async upsert(rows,options){const first=await realDb.from(table).upsert(rows,options);if(first.error)return first;return realDb.from(table).upsert(rows,options)}}}}
  const replayLog=createCatalogLogger({db:replayDb,runId:1,summary:{},clock:()=>clock++,output:()=>{}})
  await replayLog('Evento ripetuto dal trasporto',true)
  assert.equal((await pg.query('select count(*)::int n from catalog_sync_events where run_id=1')).rows[0].n,2102)
  const old={events:[{at:'2026-01-01T00:00:00.000Z',message:'prima'}],updated_at:'2026-01-01T00:00:00.000Z'}
  await pg.query('update catalog_sync_runs set summary=$1 where id=2',[JSON.stringify(old)])
  old.events.push({at:'2026-01-01T00:00:01.000Z',message:'seconda'});old.updated_at='2026-01-01T00:00:01.000Z'
  await pg.query('update catalog_sync_runs set summary=$1 where id=2',[JSON.stringify(old)])
  await pg.query('update catalog_sync_runs set summary=$1 where id=2',[JSON.stringify(old)])
  assert.equal((await pg.query('select count(*)::int n from catalog_sync_events where run_id=2')).rows[0].n,2)
  assert.equal((await pg.query("select has_table_privilege('anon','catalog_sync_events','INSERT') allowed")).rows[0].allowed,false)
 }finally{await pg.close()}
})

test('logger replays a failed flush without losing events or poisoning later writes',async()=>{
 const seen=new Set(),summaries=[],waits=[];let failures=2
 const db={from(table){return {
  async upsert(rows){for(const r of rows)seen.add(r.event_key);return {error:null}},
  update(row){return {async eq(){if(failures-->0)return {error:{code:'57014',message:'statement timeout'}};summaries.push(row.summary.current);return {error:null}}}}
 }}}
 const log=createCatalogLogger({db,runId:1,summary:{},output:()=>{},wait:async ms=>waits.push(ms)})
 await assert.rejects(log('Prima carta',true),/statement timeout/)
 await log('Seconda carta',true)
 assert.equal(seen.size,2,'replayed committed events retain their keys')
 assert.deepEqual(summaries,['Prima carta','Seconda carta'])
 assert.deepEqual(waits,[1500],'a flush only retries once before reporting failure')
})

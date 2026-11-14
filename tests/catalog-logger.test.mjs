import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {postgresClient} from './helpers/postgres-client.mjs'
import {createCatalogLogger} from '../scripts/catalog-logger.mjs'
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
  assert.equal(summary.events,undefined);assert.equal(summary.current,'Fine')
  const old={events:[{at:'2026-01-01T00:00:00.000Z',message:'prima'}],updated_at:'2026-01-01T00:00:00.000Z'}
  await pg.query('update catalog_sync_runs set summary=$1 where id=2',[JSON.stringify(old)])
  old.events.push({at:'2026-01-01T00:00:01.000Z',message:'seconda'});old.updated_at='2026-01-01T00:00:01.000Z'
  await pg.query('update catalog_sync_runs set summary=$1 where id=2',[JSON.stringify(old)])
  await pg.query('update catalog_sync_runs set summary=$1 where id=2',[JSON.stringify(old)])
  assert.equal((await pg.query('select count(*)::int n from catalog_sync_events where run_id=2')).rows[0].n,2)
  assert.equal((await pg.query("select has_table_privilege('anon','catalog_sync_events','INSERT') allowed")).rows[0].allowed,false)
 }finally{await pg.close()}
})

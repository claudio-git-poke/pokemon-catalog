import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {refreshQualityCache} from '../scripts/refresh-quality-cache.mjs'
test('public viewers read saved statistics without recalculation; only worker refreshes them',async()=>{
 const pg=new PGlite()
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create schema catalog_internal;create function catalog_internal.signal_catalog_change() returns trigger language plpgsql as 'begin return null;end';
  create table quality_fixture(n int);insert into quality_fixture values(1);grant select on quality_fixture to service_role;
  create function catalog_quality_report() returns jsonb language sql as 'select jsonb_build_object(''n'',n) from public.quality_fixture';`)
  await pg.exec(await readFile(new URL('../db/catalog-quality-cache.sql',import.meta.url),'utf8'))
  await pg.exec('set role service_role;select catalog_refresh_quality_cache();reset role;update quality_fixture set n=2;set role anon')
  assert.equal((await pg.query('select report from catalog_quality_cache')).rows[0].report.n,1)
  await assert.rejects(pg.exec('select catalog_refresh_quality_cache()'),/permission denied/)
  await assert.rejects(pg.exec("update catalog_quality_cache set report='{}'"),/permission denied/)
  await pg.exec('reset role;set role service_role;select catalog_refresh_quality_cache();reset role;set role anon')
  assert.equal((await pg.query('select report from catalog_quality_cache')).rows[0].report.n,2)
 }finally{await pg.close()}
})
test('worker retains a previous report on refresh errors',async()=>{
 const logs=[]
 assert.equal((await refreshQualityCache({db:{rpc:async()=>({error:{message:'temporary error'}})},log:s=>logs.push(s)})).errors,1)
 assert.match(logs[0],/rimandato/)
})

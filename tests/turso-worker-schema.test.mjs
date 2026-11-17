import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {workerSchemaStatements,restorePageSql} from '../scripts/turso-worker-schema.mjs'
import {captureDeltaStatements} from '../scripts/turso-worker-data.mjs'
const snapshot=JSON.parse(await readFile(new URL('../data/turso-worker-pg-schema.json',import.meta.url),'utf8'))
test('an isolated PostgreSQL restores all original functions, triggers, constraints and public/private permissions',async()=>{
 const pg=new PGlite()
 try{
  for(const [index,sql]of workerSchemaStatements(snapshot).entries()){
   try{await pg.exec(sql)}catch(error){throw Error('Worker schema statement '+index+': '+error.message,{cause:error})}
  }
  assert.equal(Number((await pg.query("SELECT count(*) n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','catalog_internal') AND p.prokind='f'")).rows[0].n),71)
  await pg.exec("SET session_replication_role=replica")
  const table=snapshot.tables.find(t=>t.name==='cards')
  await pg.exec(restorePageSql(table,[{id:900,file_name:'worker.png',sigla:'SV02@IT',lingua:'IT',numero:269,variante:'normal',nome:'Iono',image_status:'manual',image_attempts:0,manual_overrides:{notes:null},notes:null,created_at:'2026-11-17T00:00:00Z',updated_at:'2026-11-17T00:00:00Z',image_next_attempt_at:'2026-11-17T00:00:00Z',traits_next_attempt_at:'2026-11-17T00:00:00Z'}]))
  for(const sql of captureDeltaStatements(snapshot))await pg.exec(sql)
  await pg.exec("SET session_replication_role=origin; SET ROLE service_role; SELECT set_config('request.headers','{\"x-catalog-write-mode\":\"automatic\"}',false)")
  await pg.exec("UPDATE public.cards SET notes='automatic',nome='Nome nuovo' WHERE id=900")
  assert.equal((await pg.query('SELECT notes FROM public.cards WHERE id=900')).rows[0].notes,null)
  assert.equal((await pg.query("SELECT name FROM public.catalog_search_entries WHERE entry_key='card:900'")).rows[0].name,'Nome nuovo')
  await pg.exec('RESET ROLE')
  const changes=(await pg.query('SELECT * FROM catalog_internal.turso_worker_delta')).rows
  const changed=changes.find(r=>r.table_name==='cards');assert.deepEqual(changed.record_key,[900]);assert.equal(changed.first_old.nome,'Iono');assert.equal(changed.last_new.nome,'Nome nuovo');assert.equal(changed.last_new.notes,null)
  assert.ok(changes.some(r=>r.table_name==='catalog_search_entries'&&r.first_old===null&&r.last_new.entry_key==='card:900'))
  await pg.exec('RESET ROLE; SET ROLE anon')
  assert.equal((await pg.query('SELECT id FROM public.cards WHERE id=900')).rows[0].id,900)
  await assert.rejects(pg.query('SELECT * FROM public.catalog_manual_history'),/permission denied/)
 }finally{await pg.close()}
})

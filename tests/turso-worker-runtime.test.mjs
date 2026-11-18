import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {catalogFixture,schema} from './helpers/turso-fixture.mjs'
import {canonicalJson} from '../scripts/turso-snapshot.mjs'
import {estimateWrites} from '../scripts/turso-budget.mjs'
import {prepareWorkerDatabase,collectWorkerChanges,summarizeChanges,packWorkerChanges,stageWorkerRun,publishPendingWork,pendingWorkerJournals,signServiceRoleToken,UNPUBLISHED_TABLES} from '../scripts/turso-worker-runtime.mjs'
const snapshot=JSON.parse(await readFile(new URL('../data/turso-worker-pg-schema.json',import.meta.url),'utf8'))
const read=async(c,name,key)=>{const r=(await c.execute({sql:'SELECT _row FROM "_copy_'+name+'" WHERE _key=?',args:[canonicalJson(key)]})).rows[0];return r?JSON.parse(r._row):null}
const card=(id,patch={})=>({id,file_name:'f'+id+'.png',sigla:'SV02@IT',lingua:'IT',numero:id,variante:'normal',nome:'Carta '+id,image_status:'missing',image_attempts:0,manual_overrides:{},created_at:'2026-11-17T00:00:00+00:00',updated_at:'2026-11-17T00:00:00+00:00',image_next_attempt_at:'2026-11-17T00:00:00+00:00',traits_next_attempt_at:'2026-11-17T00:00:00+00:00',...patch})

test('worker restores Turso into PostgreSQL, captures importer changes and publishes them within budget',async()=>{
 const turso=await catalogFixture({cards:[card(1),card(2,{nome:'Scelta manuale',manual_overrides:{nome:'Scelta manuale'}})]})
 const pg=new PGlite()
 try{
  const logs=[]
  await prepareWorkerDatabase({client:turso,snapshot,executeSql:sql=>pg.exec(sql),authenticatorPassword:'a'.repeat(24),log:v=>logs.push(v)})
  assert.equal(Number((await pg.query('SELECT count(*) n FROM public.cards')).rows[0].n),2)
  assert.ok(logs.some(v=>v.phase==='worker-ready'))
  // An importer working through PostgREST as service_role (automatic writes).
  await pg.exec("SET ROLE service_role; SELECT set_config('request.headers','{\"x-catalog-write-mode\":\"automatic\"}',false)")
  await pg.exec("UPDATE public.cards SET image_status='found',image_url='https://img.example/1.png' WHERE id=1")
  await pg.exec("UPDATE public.cards SET nome='Nome dalla fonte' WHERE id=2")
  await pg.exec('RESET ROLE')
  const {changes,skipped}=await collectWorkerChanges(async sql=>(await pg.query(sql)).rows)
  assert.ok(changes.every(c=>!UNPUBLISHED_TABLES.has(c.table_name)))
  assert.ok(changes.some(c=>c.table_name==='cards'&&c.record_key[0]===1))
  const summary=summarizeChanges(changes)
  assert.ok(summary.estimated_writes>0&&summary.tables.cards.updates>=1)
  void skipped
  const staged=await stageWorkerRun(turso,schema,{runId:'4242',changes})
  assert.equal(staged.length,1);assert.deepEqual(await pendingWorkerJournals(turso),['4242000'])
  const result=await publishPendingWork(turso,schema,{writeBudget:1_000_000})
  assert.equal(result.complete,true);assert.equal(result.published,1)
  const first=await read(turso,'cards',[1]);assert.equal(first.image_status,'found');assert.equal(first.image_url,'https://img.example/1.png')
  assert.equal((await read(turso,'cards',[2])).nome,'Scelta manuale','manual values on Turso still win')
  assert.deepEqual(await pendingWorkerJournals(turso),[])
 }finally{await pg.close()}
})

test('large runs are split in ordered packets and resume across budgets',async()=>{
 const turso=await catalogFixture({cards:Array.from({length:6},(_,i)=>card(i+1))})
 const changes=[]
 for(let i=1;i<=6;i++){const row=JSON.parse(canonicalJson((await read(turso,'cards',[i]))));changes.push({table_name:'cards',record_key:[i],first_old:row,last_new:{...row,image_status:'found'}})}
 assert.equal(packWorkerChanges(schema,changes,{maxChanges:4}).length,2)
 const staged=await stageWorkerRun(turso,schema,{runId:'77',changes:changes.slice(0,6)})
 assert.equal(staged.length,1)
 const partial=await publishPendingWork(turso,schema,{writeBudget:estimateWrites('cards',2)})
 assert.equal(partial.complete,false)
 await assert.rejects(stageWorkerRun(turso,schema,{runId:'78',changes}),/Riprendere prima/)
 const rest=await publishPendingWork(turso,schema,{writeBudget:1_000_000})
 assert.equal(rest.complete,true)
 for(let i=1;i<=6;i++)assert.equal((await read(turso,'cards',[i])).image_status,'found')
})

test('local PostgREST token is a service-role HS256 JWT',()=>{
 const token=signServiceRoleToken('ab'.repeat(32),{now:Date.parse('2026-11-18T00:00:00Z')})
 const [header,body]=token.split('.').slice(0,2).map(p=>JSON.parse(Buffer.from(p,'base64url').toString()))
 assert.equal(header.alg,'HS256');assert.equal(body.role,'service_role');assert.equal(body.exp-body.iat,12*3600)
 assert.throws(()=>signServiceRoleToken('short'),/non valido/)
})
test('coverage and quality reports are published before large card batches',async()=>{
 const {orderWorkerChanges}=await import('../scripts/turso-worker-publish.mjs')
 const report={scope:'latest',report:{},updated_at:'2026-11-18T00:00:00+00:00'}
 const changes=[...Array.from({length:3},(_,i)=>({table_name:'cards',record_key:[i+1],first_old:null,last_new:{id:i+1}})),{table_name:'catalog_coverage_snapshots',record_key:['latest'],first_old:null,last_new:report},{table_name:'catalog_quality_cache',record_key:['catalog'],first_old:null,last_new:{...report,scope:'catalog'}}]
 const ordered=orderWorkerChanges(schema,changes).map(c=>c.table_name)
 assert.deepEqual(ordered.slice(0,2).sort(),['catalog_coverage_snapshots','catalog_quality_cache'])
})

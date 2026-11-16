import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {postgresClient} from './helpers/postgres-client.mjs'
import {auditSourceList,sourceList,runSourceManifestAudit,manifestFetcher} from '../scripts/source-manifest-audit.mjs'
const sql=await readFile(new URL('../db/source-manifest-audit.sql',import.meta.url),'utf8')
async function fixture(){
 const pg=new PGlite()
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table cards(id bigint primary key,source_uid text unique,nome text,sigla text,manual_overrides jsonb);
 create table catalog_sync_sets(source_uid text primary key,provider text,source_language text,set_id text,name text,
 next_sync_at timestamptz default now()+interval '7 days',last_sync_at timestamptz,last_error text,coverage_scope text default 'unclassified',
 manifest_count int,resolved_count int,manifest_digest text,resolved_digest text,coverage_checked_at timestamptz,coverage_detail jsonb);
 alter table catalog_sync_sets enable row level security;
 grant all on catalog_sync_sets,cards to service_role;grant select on catalog_sync_sets to anon;create policy read_sets on catalog_sync_sets for select to anon using(true);`)
 await pg.exec(sql)
 await pg.exec(`insert into cards values(1,'tcgdex:en:test-1','Mio nome','BOO','{"nome":"Mio nome","sigla":"BOO"}'),(2,'tcgdex:fr:test-2','Autre langue','TEST','{}');
 insert into catalog_sync_sets(source_uid,provider,source_language,set_id,name,last_sync_at,last_error) values
 ('tcgdex:en:test','tcgdex','en','test','Test',now()-interval '1 day','Errore importazione da conservare');set role service_role;`)
 const base=postgresClient(pg)
 const db={...base,rpc:async(name,args)=>{
  try{assert.equal(name,'catalog_save_manifest_audit');const a=Object.values(args).map(v=>v&&typeof v==='object'?JSON.stringify(v):v)
   return {data:(await pg.query('select catalog_save_manifest_audit($1,$2,$3,$4) saved',a)).rows[0].saved,error:null}
  }catch(e){return {data:null,error:{message:e.message,code:e.code}}}
 }}
 return {pg,db,job:(await pg.query("select * from catalog_sync_sets where source_uid='tcgdex:en:test'")).rows[0]}
}
const list={ids:['test-1','test-2'],uid:id=>'tcgdex:en:'+id,url:'https://api.tcgdex.net/v2/en/sets/test',scope:'source_set'}
test('compares exact language-scoped IDs without touching manual corrections, source/import queues or dates',async()=>{
 const {pg,db,job}=await fixture();try{
  const before=(await pg.query('select * from cards order by id')).rows,queue=(await pg.query('select next_sync_at,last_sync_at,last_error from catalog_sync_sets')).rows
  const result=await auditSourceList({db,job,list});assert.deepEqual(result,{saved:true,checked:2,missing:1})
  assert.deepEqual((await pg.query('select * from cards order by id')).rows,before)
  assert.deepEqual((await pg.query('select next_sync_at,last_sync_at,last_error from catalog_sync_sets')).rows,queue)
  const row=(await pg.query('select * from catalog_sync_sets')).rows[0]
  assert.equal(row.coverage_detail.unexpected_count,null);assert.deepEqual(row.coverage_detail.missing_ids,['test-2'])
  assert.equal(row.coverage_detail.comparison_scope,'expected_source_links');assert.ok(Date.parse(row.manifest_next_check_at)>Date.now())
  const run=await runSourceManifestAudit({db,log:()=>{},loadList:()=>{throw Error('already checked job must be skipped')}})
  assert.equal(run.checked_lists,0);assert.equal(run.errors,0)
 }finally{await pg.close()}
})
test('reads at most 200 indexed IDs per query; keeps duplicate evidence and never invents cross-source equivalents',async()=>{
 const {pg,db,job}=await fixture();try{
  let calls=0;const bounded={...db,from:table=>{assert.equal(table,'cards');const q=db.from(table),old=q.in;q.in=(key,values)=>{assert.ok(values.length<=200);calls++;return old(key,values)};return q}}
  const ids=Array.from({length:201},(_,i)=>'test-'+(i+1));ids.push('test-1')
  const result=await auditSourceList({db:bounded,job,list:{...list,ids}})
  assert.equal(calls,2);assert.equal(result.missing,200)
  const saved=(await pg.query('select coverage_detail,manifest_count,resolved_count from catalog_sync_sets')).rows[0]
  assert.equal(saved.manifest_count,202);assert.equal(saved.resolved_count,1);assert.equal(saved.coverage_detail.duplicate_count,1);assert.equal(saved.coverage_detail.missing_ids.length,30)
 }finally{await pg.close()}
})
test('concurrent import results win over an older audit; failures preserve the last successful evidence',async()=>{
 const {pg,db,job}=await fixture();try{
  await pg.exec("update catalog_sync_sets set coverage_checked_at=now(),coverage_detail='{\"importer\":true}'")
  assert.equal((await auditSourceList({db,job,list})).saved,false)
  assert.equal((await pg.query('select coverage_detail from catalog_sync_sets')).rows[0].coverage_detail.importer,true)
  const result=await runSourceManifestAudit({db,log:()=>{},loadList:async()=>{throw Error('Elenco HTTP 503')}})
  assert.equal(result.errors,1);assert.equal(result.checked_lists,0)
  const row=(await pg.query('select * from catalog_sync_sets')).rows[0]
  assert.equal(row.coverage_detail.importer,true);assert.match(row.manifest_last_error,/503/);assert.match(row.last_error,/importazione/)
 }finally{await pg.close()}
})
test('source rate limits defer that provider while other queues progress; database errors abort',async()=>{
 const {pg,db}=await fixture();try{
  await pg.exec(`insert into catalog_sync_sets(source_uid,provider,source_language,set_id,name) values
  ('tcgdex:en:other','tcgdex','en','other','Other'),('research:pokumon:00001','research-pokumon','multi','1','Pokumon');`)
  const called=[]
  const run=await runSourceManifestAudit({db,log:()=>{},loadList:async job=>{called.push(job.provider);if(job.provider==='tcgdex')throw Error('Elenco HTTP 429');return {...list,ids:['pokumon:1'],uid:id=>id}}})
  assert.equal(called.filter(p=>p==='tcgdex').length,1);assert.equal(run.errors,1);assert.equal(run.checked_lists,1)
  const errorDb={...db,from:table=>{const q=db.from(table);if(table==='cards')q.then=resolve=>resolve({error:{code:'42501',message:'permission denied'}});return q}}
  const job=(await pg.query("select * from catalog_sync_sets where source_uid='tcgdex:en:test'")).rows[0]
  await assert.rejects(auditSourceList({db:errorDb,job,list}),/permission denied/)
 }finally{await pg.close()}
})
test('public clients can read outcomes but cannot certify manifests or move the queue',async()=>{
 const {pg,db,job}=await fixture();try{
  await auditSourceList({db,job,list});await pg.exec('reset role;set role anon')
  assert.equal((await pg.query('select resolved_count from catalog_sync_sets')).rows[0].resolved_count,1)
  await assert.rejects(pg.query('select catalog_save_manifest_audit($1,$2,$3,$4)',[job.source_uid,job.set_id,null,'{}']),/permission denied/)
  await assert.rejects(pg.exec("update catalog_sync_sets set manifest_next_check_at=now()"),/permission denied/)
 }finally{await pg.close()}
})
test('session limits keep unfinished jobs due, skip explicit digital sets and defer no empty-list zeroes',async()=>{
 const {pg,db}=await fixture();try{
  await pg.exec(`insert into catalog_sync_sets(source_uid,provider,source_language,set_id,name,coverage_scope) values
   ('tcgdex:en:next','tcgdex','en','next','Next','physical'),('tcgdex:en:pocket','tcgdex','en','pocket','Pocket','digital');`)
  let reads=0
  const result=await runSourceManifestAudit({db,maxJobs:1,log:()=>{},loadList:async()=>{reads++;return list}})
  assert.equal(reads,1);assert.equal(result.checked_lists,1);assert.equal(result.deferred,true)
  const remaining=(await pg.query("select count(*)::int n from catalog_sync_sets where manifest_next_check_at<=now() and coverage_scope<>'digital'")).rows[0].n
  assert.equal(remaining,1)
  const next=(await pg.query("select * from catalog_sync_sets where manifest_next_check_at<=now() and coverage_scope<>'digital'")).rows[0]
  await assert.rejects(auditSourceList({db,job:next,list:{...list,ids:[]}}),/vuoto/)
  assert.equal((await pg.query('select manifest_count from catalog_sync_sets where source_uid=$1',[next.source_uid])).rows[0].manifest_count,null)
 }finally{await pg.close()}
})
test('source parsers reject empty/mismatched manifests and Pocket; page checks stay page-scoped',async()=>{
 const job={provider:'tcgdex',source_language:'it',set_id:'base3'}
 await assert.rejects(sourceList(job,{request:async()=>({id:'base4',cards:[{id:'base3-1'}]})}),/discordante/)
 await assert.rejects(sourceList(job,{request:async()=>({id:'base3',cards:[]})}),/vuoto/)
 await assert.rejects(sourceList(job,{request:async()=>({id:'base3',cards:[{id:'base4-1'}]})}),/identificativi/)
 assert.equal((await sourceList(job,{request:async()=>({id:'base3',serie:{id:'tcgp'}})})).excluded,true)
 const physical=await sourceList(job,{request:async()=>({id:'base3',cards:[{id:'base3-1'}]})});assert.equal(physical.uid('base3-1'),'tcgdex:it:base3-1')
 const html=await readFile(new URL('fixtures/official-th-list.html',import.meta.url),'utf8')
 const page=await sourceList({provider:'supplement-th',source_language:'th',set_id:'1'},{request:async()=>html})
 assert.equal(page.scope,'source_page');assert.equal(page.ids.length,20);assert.ok(page.ids.every(id=>id.startsWith('asia-official:th:')))
 await assert.rejects(sourceList({provider:'supplement-th',source_language:'th',set_id:'9999'},{request:async()=>html}),/paginazione/)
 const pokumon=await sourceList({provider:'research-pokumon',set_id:'1'},{request:async()=>[{id:123,status:'publish'}]})
 assert.deepEqual(pokumon.ids,['pokumon:123'])
 const limitless=await sourceList({provider:'research-limitless',source_language:'it',set_id:JSON.stringify({lang:'it',set:'SVI',offset:50})},{request:async()=>'<a href="/cards/it/SVI/1">A</a>'})
 assert.deepEqual(limitless.ids,['limitless:it:SVI:1'])
})
test('archive manifests use original IDs, never printed numbers or translated equivalents',async()=>{
 const atlas=await sourceList({provider:'atlas',source_language:'ja',set_id:'S8a'},{root:'unused',loadAtlas:async()=>[{id:'S8a-123'},{id:'S8a-456'}]})
 assert.equal(atlas.uid(atlas.ids[0]),'atlas:ja:S8a-123')
 const root=await mkdtemp(path.join(tmpdir(),'manifest-'))
 try{
  const dir=path.join(root,'data_en','Gym','G1');await mkdir(dir,{recursive:true})
  await writeFile(path.join(dir,'one.json'),JSON.stringify({url:'https://pkmncards.com/card/test/',name:'Test',set_name:'G1',number:'1',img:'https://pkmncards.com/wp-content/uploads/test.jpg'}))
  const english=await sourceList({provider:'supplement-en',set_id:'["Gym","G1"]'},{root});assert.deepEqual(english.ids,['pkmncards:Gym:G1:one.json'])
  await writeFile(path.join(dir,'bad.json'),'{}');await assert.rejects(sourceList({provider:'supplement-en',set_id:'["Gym","G1"]'},{root}),/non validata/)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('fetcher paces source requests, rejects redirects and reports HTTP errors',async()=>{
 const waits=[];let at=10000
 const request=manifestFetcher({clock:()=>at,wait:async ms=>{waits.push(ms);at+=ms},fetchImpl:async(url,options)=>{assert.equal(options.redirect,'error');return {ok:true,json:async()=>({ok:true})}}})
 await request('https://api.tcgdex.net/v2/it/sets/base3',true);await request('https://api.tcgdex.net/v2/it/sets/base4',true)
 assert.equal(waits[1],1100);await assert.rejects(request('https://example.com/'),/autorizzato/)
 await assert.rejects(manifestFetcher({wait:async()=>{},fetchImpl:async()=>({ok:false,status:429})})('https://pokumon.com/'),/429/)
})

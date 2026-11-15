import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {compareCardLists,compareSourcePair} from '../scripts/compare-sources.mjs'
import {postgresClient} from './helpers/postgres-client.mjs'
const card=(n,name='ピカチュウ')=>({localId:n,name,id:'card-'+n})
test('cross-source lists detect missing numbers and conflicting names even with equal totals',()=>{
 assert.equal(compareCardLists([card('001')],[card('1')]).status,'concordant')
 const sameCount=compareCardLists([card('1'),card('2')],[card('1'),card('3')])
 assert.equal(sameCount.status,'differences');assert.equal(sameCount.only_primary[0].number,'2');assert.equal(sameCount.only_secondary[0].number,'3')
 const names=compareCardLists([card('1','Pikachu')],[card('1','Raichu')]);assert.equal(names.name_difference_count,1)
 assert.equal(compareCardLists([card('1'),card('1')],[card('1')]).status,'uncomparable')
 assert.equal(compareCardLists([card('UNNUMBERED:a')],[card('1')]).status,'uncomparable')
 assert.equal(compareCardLists([card('0')],[card('0')]).status,'uncomparable')
 assert.equal(compareCardLists([],[]).status,'uncomparable')
 assert.equal(compareCardLists([],[card('1')]).only_secondary_count,1)
 assert.equal(names.independence_status,'unestablished');assert.equal(names.variants_status,'unverified')
})
test('regional pairing is read-only publicly and failed comparisons retain previous evidence',async()=>{
 const pg=new PGlite()
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create table catalog_sync_sets(source_uid text primary key,provider text,source_language text,set_id text,name text,coverage_scope text default 'physical',last_sync_at timestamptz,card_count integer,last_error text);
  create table catalog_language_sources(source_language text,label text);
  create table catalog_external_cards(source_uid text,provider text,language text,set_code text,local_id text,name text,page_url text);
  grant select on catalog_sync_sets,catalog_language_sources to anon;
  insert into catalog_sync_sets values('t:ja','tcgdex','ja','S8a','Set','physical',now(),1,null),('a:ja','atlas','ja','s8a','Set','physical',now(),1,null),('a:ko','atlas','ko','s8a','Set','physical',now(),1,null);
  insert into catalog_external_cards values('a:1','atlas-official-ja','JP','s8a','1','ピカチュウ','https://www.pokemon-card.com/');`)
  await pg.exec(await readFile(new URL('../db/catalog-cross-source.sql',import.meta.url),'utf8'))
  const pair=(await pg.query('select * from catalog_cross_source_register')).rows[0]
  assert.equal((await pg.query('select count(*) n from catalog_cross_source_register')).rows[0].n,1,'no Japanese/Korean cross-pair')
  const db=postgresClient(pg)
  const ok=await compareSourcePair({db,pair,fetchSet:async()=>({id:'S8a',serie:{id:'swsh'},cards:[card('001')]})})
  assert.equal(ok.status,'concordant')
  const saved=(await pg.query('select * from catalog_source_comparisons')).rows[0]
  const fail=await compareSourcePair({db,pair:{...pair,...saved},fetchSet:async()=>{throw Error('HTTP 503')}})
  assert.equal(fail.status,'error')
  assert.equal((await pg.query('select result from catalog_source_comparisons')).rows[0].result.primary_count,1)
  const bad=await compareSourcePair({db,pair,fetchSet:async()=>({id:'other',cards:[card('1')]})})
  assert.equal(bad.status,'error')
  await pg.exec('set role anon')
  const report=(await pg.query('select catalog_cross_source_report() r')).rows[0].r
  assert.equal(report.total,1);assert.equal(report.rows[0].independence_status,'unestablished')
  await assert.rejects(pg.exec("update catalog_source_comparisons set status='concordant'"),/permission denied/)
  await assert.rejects(pg.exec('select catalog_cross_source_due(1)'),/permission denied/)
 }finally{await pg.close()}
})

test('spacing differences stay visible without hiding suffixes or certifying identities',()=>{
 const r=compareCardLists([card('1','アローラロコン'),card('2','シェイミ')],[card('1','アローラ ロコン'),card('2','シェイミprismstar')])
 assert.equal(r.status,'differences');assert.equal(r.spacing_difference_count,1);assert.equal(r.other_name_difference_count,1)
 assert.equal(r.name_differences[0].kind,'spacing_only');assert.equal(r.name_differences[1].kind,'other')
 assert.equal(r.comparison_version,3);assert.equal(r.variants_status,'unverified')
})

test('source-only cards are checked by exact source identity without assuming absence or merging duplicates',async()=>{
 const {auditPrimaryCatalogLinks}=await import('../scripts/compare-sources.mjs')
 const pg=new PGlite()
 try{
  await pg.exec("create table cards(id int,source_uid text);insert into cards values(1,'tcgdex:ja:card-1'),(2,'tcgdex:ko:card-2')")
  const result=await auditPrimaryCatalogLinks({db:postgresClient(pg),primary:[card('1'),card('2'),card('3'),card('3'),{localId:'4',name:'無名'}],secondary:[],language:'ja',clock:()=>0})
  assert.equal(result.linked_count,1);assert.equal(result.not_linked_count,1);assert.equal(result.uncheckable_count,2)
  assert.equal(result.linked[0].catalog_id,1);assert.equal(result.not_linked[0].number,'2','Korean identity does not satisfy Japanese source link')
  assert.equal(result.checked_at,'1970-01-01T00:00:00.000Z')
  assert.equal((await pg.query('select count(*) n from cards')).rows[0].n,2)
 }finally{await pg.close()}
})

test('failed catalog-link reads stay unknown and never report zero missing cards',async()=>{
 const {auditPrimaryCatalogLinks}=await import('../scripts/compare-sources.mjs')
 const db={from(){return {select(){return this},in(){return Promise.resolve({data:null,error:{message:'statement timeout'}})}}}}
 const result=await auditPrimaryCatalogLinks({db,primary:[card('1')],secondary:[],language:'ja'})
 assert.equal(result.status,'unavailable');assert.equal(result.not_linked_count,undefined)
})

test('Atlas-only evidence uses its original namespace and rejects a different language',async()=>{
 const {auditPrimaryCatalogLinks}=await import('../scripts/compare-sources.mjs')
 const pg=new PGlite()
 try{
  await pg.exec("create table cards(id int,source_uid text);insert into cards values(8,'atlas:ja:CP3-31601'),(9,'tcgdex:ja:CP3-2')")
  const result=await auditPrimaryCatalogLinks({db:postgresClient(pg),provider:'atlas',language:'ja',secondary:[],primary:[{...card('1'),id:'atlas:ja:CP3-31601'},{...card('2'),id:'atlas:ja:CP3-31602'},{...card('3'),id:'atlas:ko:CP3-31603'}]})
  assert.equal(result.scope,'secondary_only_exact_source_links');assert.equal(result.linked_count,1);assert.equal(result.linked[0].catalog_id,8)
  assert.equal(result.not_linked_count,1);assert.equal(result.uncheckable_count,1)
  assert.equal(result.not_linked[0].source_uid,'atlas:ja:CP3-31602','no double prefix or translation to another provider')
 }finally{await pg.close()}
})

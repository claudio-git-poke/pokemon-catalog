import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {actualLanguage,inventoryRecord,syncPrintingInventory} from '../scripts/printing-inventory.mjs'
import {postgresClient} from './helpers/postgres-client.mjs'
const entry=(p={})=>({entry_key:'test:normal',card_id:1,name:'Pikachu',set_code:'TEST@INT',language:'INT',collector_number:'1',tags:[],facts:{},verification:'source',source_url:'https://source.test/card',updated_at:'2020-01-01T00:00:00Z',source_payload:{source_language:'en',variant:{type:'normal'}},...p})
test('inventory distinguishes a language grouping, unknown finish, actual printings and generic art',()=>{
 assert.equal(actualLanguage('INT'),null);assert.equal(actualLanguage('en'),'EN');assert.equal(actualLanguage('zh-tw'),'CHN-T')
 const ordinary=inventoryRecord({entry:entry(),card:{image_status:'found',image_url:'https://image.test/card.png'}})
 assert.equal(ordinary.language,'EN');assert.equal(ordinary.scope,'printing');assert.equal(ordinary.image_url,null);assert.equal(ordinary.image_status,'missing');assert.ok(ordinary.reference_image_url)
 const unknown=inventoryRecord({entry:entry({source_payload:{metadata_scope:'card-metadata-only'}})})
 assert.equal(unknown.language,'und');assert.equal(unknown.scope,'card')
 assert.equal(inventoryRecord({entry:entry(),card:{source_language:'it'}}).language_status,'conflict')
 assert.equal(inventoryRecord({entry:entry({source_payload:{source_language:'en',variant:{stamp:['1st-edition']}}})}).scope,'card','stamp without finish does not invent a physical variant')
 const placeholder=inventoryRecord({entry:entry(),card:{image_status:'placeholder',image_url:'https://image.test/card.png'}})
 assert.equal(placeholder.reference_image_url,null)
})
test('only explicit printing-language image evidence can become a photo, with separate image review',()=>{
 const base=entry({image_url:'https://image.test/exact.png',verification:'reviewed',source_payload:{source_language:'en',variant:{type:'reverse',foil:'masterball'},image_scope:'printing-language',image_language:'EN'}})
 assert.equal(inventoryRecord({entry:base}).image_status,'candidate','reviewed traits do not verify the photo')
 assert.equal(inventoryRecord({entry:{...base,source_payload:{...base.source_payload,image_reviewed:true}}}).image_status,'verified')
 assert.equal(inventoryRecord({entry:{...base,source_payload:{...base.source_payload,image_language:'JP'}}}).image_url,null)
 assert.equal(inventoryRecord({entry:{...base,source_payload:{...base.source_payload,reference_image_only:true}}}).image_url,null)
 assert.equal(inventoryRecord({entry:{...base,image_url:'https://user:secret@image.test/p.png'}}).image_url,null)
})
test('incremental inventory survives replay, concurrent edits and deletions while preserving Bindex keys and public read-only access',async()=>{
 const pg=new PGlite()
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table cards(id bigint primary key,nome text,sigla text,lingua text,numero int,source_local_id text,codice text,source_card_id text,source_language text,image_url text,image_status text);
   grant select,update on cards to anon;
   insert into cards values(1,'Pikachu','TEST@INT','INT',1,'1','TEST 001','test-1','en','https://image.test/reference.png','found');`)
  await pg.exec(await readFile(new URL('../db/catalog-identification.sql',import.meta.url),'utf8'))
  await pg.exec(await readFile(new URL('../db/bindex-export.sql',import.meta.url),'utf8'))
  await pg.exec("insert into set_espansioni(sigla,nome,lingua) values('TEST','Test','INT');insert into set_carte(sigla,numero,variante,nome) values('TEST',1,'reverse','Pikachu')")
  for(const row of [entry(),entry({entry_key:'test:reverse',source_payload:{source_language:'en',variant:{type:'reverse'}}})])await pg.query('insert into catalog_search_entries(entry_key,card_id,name,set_code,language,source_url,source_payload,verification) values($1,1,$2,$3,$4,$5,$6,$7)',[row.entry_key,row.name,row.set_code,row.language,row.source_url,JSON.stringify(row.source_payload),row.verification])
  await pg.exec("insert into catalog_export_links(entry_key,sigla,numero,variante,method) values('test:reverse','TEST',1,'reverse','test')")
  await pg.exec(await readFile(new URL('../db/printing-inventory.sql',import.meta.url),'utf8'))
  const db={...postgresClient(pg),async rpc(name,args={}){try{let rows;if(name==='catalog_inventory_queue')({rows}=await pg.query('select * from catalog_inventory_queue($1)',[args.batch_size]));else if(name==='catalog_inventory_ack')({rows}=await pg.query('select catalog_inventory_ack($1)',[JSON.stringify(args.items)]));else throw Error(name);return {data:rows,error:null}}catch(e){return {data:null,error:{message:e.message}}}}}
  await pg.exec('select catalog_inventory_seed(500)')
  assert.equal((await syncPrintingInventory({db,log:()=>{}})).processed,2)
  assert.equal((await pg.query('select count(*) n from catalog_inventory_dirty')).rows[0].n,0)
  const reverse=(await pg.query("select * from catalog_printing_inventory where record_key='test:reverse'")).rows[0]
  assert.equal(reverse.language,'EN');assert.equal(reverse.canonical_variante,'reverse');assert.equal(reverse.image_status,'missing')
  await pg.exec("update catalog_search_entries set name='Updated' where entry_key='test:normal'")
  const job=(await pg.query('select * from catalog_inventory_queue(1)')).rows[0]
  await pg.exec("update catalog_search_entries set name='Newer' where entry_key='test:normal'")
  await db.rpc('catalog_inventory_ack',{items:[{entry_key:'test:normal',requested_at:job.requested_at}]})
  assert.equal((await pg.query('select count(*) n from catalog_inventory_dirty')).rows[0].n,1,'stale acknowledgment cannot lose a concurrent edit')
  await syncPrintingInventory({db,log:()=>{}})
  assert.equal((await pg.query("select name from catalog_printing_inventory where record_key='test:normal'")).rows[0].name,'Newer')
  await pg.exec("set role anon;update cards set image_url='https://image.test/new-reference.png' where id=1;reset role;")
  assert.equal((await pg.query('select count(*) n from catalog_inventory_dirty')).rows[0].n,2,'legacy anonymous card edit can queue derived data without direct queue access')
  await syncPrintingInventory({db,log:()=>{}})
  await pg.exec("delete from catalog_search_entries where entry_key='test:normal'")
  assert.equal((await pg.query("select deleted from catalog_printing_inventory where record_key='test:normal'")).rows[0].deleted,true)
  await assert.rejects(pg.exec("update catalog_printing_inventory set record_key='changed' where record_key='test:reverse'"),/immutabile/)
  await assert.rejects(pg.exec('delete from catalog_printing_inventory'),/deleted/)
  await pg.exec("update catalog_printing_inventory set image_url='https://image.test/verified.png',image_source_url='https://source.test/review',image_status='verified' where record_key='test:reverse'")
  await pg.exec("update catalog_printing_inventory set image_url=null,image_hd=null,image_source_url=null,image_status='missing' where record_key='test:reverse'")
  assert.equal((await pg.query("select image_status from catalog_printing_inventory where record_key='test:reverse'")).rows[0].image_status,'verified','weak imports cannot replace a reviewed photo')
  // Equal timestamps and tombstones are exported with a complete composite cursor.
  await pg.exec("alter table catalog_printing_inventory disable trigger catalog_inventory_guard;update catalog_printing_inventory set updated_at='2020-01-01T00:00:00.123456Z';alter table catalog_printing_inventory enable trigger catalog_inventory_guard;set role anon")
  const first=(await pg.query("select bindex_printing_page('1970-01-01','','2021-01-01',1) p")).rows[0].p
  assert.equal(first.items.length,1);assert.equal(first.items[0].deleted,true);assert.equal(first.complete,false)
  const next=(await pg.query('select bindex_printing_page($1,$2,$3,1) p',[first.next_cursor.time,first.next_cursor.key,first.until])).rows[0].p
  assert.equal(next.items[0].canonical_key.variante,'reverse');assert.equal(next.items[0].language,'EN')
  await assert.rejects(pg.exec('select * from catalog_inventory_queue(1)'),/permission denied/)
  await assert.rejects(pg.exec('update catalog_printing_inventory set deleted=true'),/permission denied/)
  assert.equal((await pg.query('select numero,variante from set_carte')).rows[0].variante,'reverse')
 }finally{await pg.close()}
})

test('a promotional printing never inherits the origin card language or image as proof',()=>{
 const promo=entry({release_code:'trick-or-trade-2024',release_year:2024,tags:['family:trick-or-trade'],source_payload:{holo:true,reference_image_only:true}})
 const record=inventoryRecord({entry:promo,card:{source_language:'en',image_status:'found',image_url:'https://image.test/origin.png'}})
 assert.equal(record.scope,'printing');assert.equal(record.language,'und');assert.equal(record.image_status,'missing');assert.equal(record.image_url,null)
 assert.ok(record.reference_image_url)
 const documented=inventoryRecord({entry:{...promo,source_payload:{...promo.source_payload,printing_language:'it'}}})
 assert.equal(documented.language,'IT')
})

test('stale or conflicting canonical links remain review items without rewriting any Bindex key',()=>{
 const linked={sigla:'PAL',numero:50,variante:'normale'}
 const r=inventoryRecord({entry:entry({source_payload:{source_language:'en',variant:{type:'reverse'}}}),link:linked})
 assert.equal(r.canonical_mapping_status,'review');assert.equal(r.canonical_sigla,null);assert.equal(linked.variante,'normale')
 const pending=inventoryRecord({entry:entry(),link:{...linked,pending_reason:'product_number_conflict'}})
 assert.equal(pending.mapping_reason,'product_number_conflict');assert.equal(pending.canonical_mapping_status,'review')
})

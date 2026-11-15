import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {detailEntries,quarantineVariantCollisions} from '../scripts/enrich-catalog.mjs'
import {postgresClient} from './helpers/postgres-client.mjs'
const card={id:74073,nome:'Charizard-ex',sigla:'SV03@IT',lingua:'IT',source_language:'it'}
const detail=JSON.parse(await readFile(new URL('fixtures/tcgdex-reused-variant-id.json',import.meta.url)))
test('real Charizard variants sharing a vendor ID preserve every distinct product and require review',()=>{
 const rows=detailEntries(card,detail),keys=rows.map(e=>e.entry_key)
 assert.equal(rows.length,5);assert.equal(new Set(keys).size,5)
 assert.deepEqual(rows.slice(2).map(e=>e.source_payload.variant.thirdParty.cardmarket),[756342,782239,811099])
 assert.ok(rows.slice(2).every(e=>e.source_payload.identity_review_required===true))
 assert.equal(rows[0].entry_key,'tcgdex:74073:jr7oetx1mqug9');assert.equal(rows[0].facts.shiny,true)
 assert.equal(rows[1].facts.oversized,true);assert.equal(rows[0].source_payload.source_variant_values.type,'Olografica')
 const reversed=detailEntries(card,{...detail,variants_detailed:[...detail.variants_detailed].reverse()})
 assert.deepEqual(reversed.map(e=>e.entry_key).sort(),keys.sort())
})
test('identical variants and price-only changes are consolidated without dropping distinct variants',()=>{
 const v=detail.variants_detailed[2]
 const rows=detailEntries(card,{...detail,variants_detailed:[v,{...v,pricing:{changed:123}},...detail.variants_detailed]})
 assert.equal(rows.length,5);assert.equal(new Set(rows.map(e=>e.entry_key)).size,5)
})
test('PostgreSQL accepts repeated imports and quarantines ambiguous legacy entries while preserving reviews',async()=>{
 const pg=new PGlite();try{
  const rows=detailEntries(card,detail),types={card_id:'bigint',release_year:'integer',tags:'text[]',facts:'jsonb',source_payload:'jsonb'}
  await pg.exec('create table catalog_search_entries('+Object.keys(rows[0]).map(k=>k+' '+(types[k]||'text')+(k==='entry_key'?' primary key':'')).join(',')+')')
  const db=postgresClient(pg),legacy=rows[2].source_payload.ambiguous_legacy_entry_key
  await db.from('catalog_search_entries').upsert({...rows[2],entry_key:legacy},{onConflict:'entry_key'})
  await quarantineVariantCollisions(db,rows)
  let old=(await pg.query('select source_payload from catalog_search_entries where entry_key=$1',[legacy])).rows[0]
  assert.equal(old.source_payload.metadata_scope,'card-metadata-only');assert.equal(old.source_payload.identity_review_required,true)
  for(let n=0;n<2;n++){const result=await db.from('catalog_search_entries').upsert(rows,{onConflict:'entry_key'});assert.equal(result.error,null)}
  assert.equal((await pg.query('select count(*)::int n from catalog_search_entries')).rows[0].n,6)
  await pg.query("update catalog_search_entries set verification='reviewed',source_payload='{}' where entry_key=$1",[legacy])
  await quarantineVariantCollisions(db,rows)
  old=(await pg.query('select source_payload from catalog_search_entries where entry_key=$1',[legacy])).rows[0]
  assert.deepEqual(old.source_payload,{})
 }finally{await pg.close()}
})

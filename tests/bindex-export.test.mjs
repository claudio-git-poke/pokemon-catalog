import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {referenceTags,variantKey,resolvePublication} from '../scripts/bindex-identity.mjs'
test('Bindex keys preserve sole-holo semantics, subtype and set-wide stamp rules',()=>{
 assert.equal(variantKey({type:'holo'},false),'normale')
 assert.equal(variantKey({type:'holo'},true),'holo')
 assert.equal(variantKey({type:'holo'},undefined),null)
 assert.equal(variantKey({type:'normal',subtype:'shadowless',stamp:['1st-edition']},true),'normale-shadowless-1st-edition')
 assert.equal(variantKey({type:'normal',stamp:['30th-anniversary']},true),'normale')
 assert.ok(!referenceTags({sigla:'MFB',variante:'normale'}).includes('finish:normal'))
 assert.ok(referenceTags({sigla:'PPS9',variante:'normale'}).includes('family:prize-pack'))
})
test('exact MFB product plus name preserves original ordinal and rejects reused source IDs',()=>{
 const sets=[{sigla:'MFB',lingua:'INT'}],ref=[{sigla:'MFB',numero:39,variante:'normale',nome:'Bulbasaur',cardmarket_id:741976}]
 const e={tags:['family:my-first-battle'],language:'INT',set_code:'MFB',source_payload:{variant:{type:'normal',thirdParty:{cardmarket:741976}},has_normal_variant:true}}
 assert.equal(resolvePublication(e,{nome:'Bulbasaur'},sets,ref).row.numero,39)
 assert.equal(resolvePublication(e,{nome:'Charmander'},sets,ref).reason,'mfb_product_identity_unverified')
 const wrong={...e,source_payload:{...e.source_payload,product_variant_count:2,variant:{...e.source_payload.variant,subtype:'blue-border'}}}
 assert.equal(resolvePublication(wrong,{nome:'Bulbasaur'},sets,ref).reason,'ambiguous_source_product_id')
 assert.equal(resolvePublication({...e,language:'JP'},{nome:'Bulbasaur'},sets,ref).reason,'asian_ordinal_requires_verified_page')
})
test('ordinary sets use the confirmed alias, while unknown aliases and product conflicts remain pending',()=>{
 const sets=[{sigla:'PAL',tcgdex_id:'sv02',lingua:'INT'}],card={nome:'Pikachu',sigla:'SV02@INT'}
 const e={tags:[],language:'INT',set_code:'SV02@INT',collector_number:'50',source_payload:{set:{id:'sv02'},variant:{type:'reverse'},has_normal_variant:true}}
 const r=resolvePublication(e,card,sets,[]);assert.equal(r.row.sigla,'PAL');assert.equal(r.row.numero,50);assert.equal(r.row.variante,'reverse');assert.equal(r.row.codice,'PAL 050')
 assert.equal(resolvePublication(e,card,[],[]).reason,'set_alias_unconfirmed')
 const existing={...r.row,cardmarket_id:100};assert.equal(resolvePublication({...e,source_payload:{...e.source_payload,variant:{type:'reverse',thirdParty:{cardmarket:200}}}},card,sets,[existing]).reason,'product_identity_conflict')
})
test('export enforces immutable keys, tombstones, change timestamps, and anonymous read only',async()=>{
 const pg=new PGlite()
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create table catalog_search_entries(entry_key text primary key,updated_at timestamptz,verification text);`)
  await pg.exec(await readFile(new URL('../db/bindex-export.sql',import.meta.url),'utf8'))
  await pg.exec(`insert into set_espansioni(sigla,nome,lingua) values('PAL','Paldea','INT');insert into set_carte(sigla,numero,variante,nome) values('PAL',50,'normale','Pikachu')`)
  const before=(await pg.query('select aggiornato_il from set_carte')).rows[0].aggiornato_il
  await pg.exec("update set_carte set nome='Pikachu'")
  assert.equal((await pg.query('select aggiornato_il from set_carte')).rows[0].aggiornato_il.toISOString(),before.toISOString())
  await assert.rejects(pg.exec("update set_carte set numero=51"),/immutabile/)
  await assert.rejects(pg.exec('delete from set_carte'),/eliminata/)
  await pg.exec("update set_carte set tag=array['visual:shiny'],eliminata=true")
  assert.ok((await pg.query('select aggiornato_il from set_carte')).rows[0].aggiornato_il>before)
  await pg.exec('set role anon')
  assert.equal((await pg.query('select eliminata from set_carte')).rows[0].eliminata,true)
  await assert.rejects(pg.exec("update set_carte set nome='bad'"),/permission denied/)
  await assert.rejects(pg.exec('select * from catalog_export_links'),/permission denied/)
  await assert.rejects(pg.exec('select * from catalog_export_queue()'),/permission denied/)
 }finally{await pg.close()}
})
test('different suffix order preserves the existing key instead of creating a duplicate printing',()=>{
 const sets=[{sigla:'BASE1',tcgdex_id:'base1',lingua:'INT'}]
 const existing={sigla:'BASE1',numero:4,variante:'normale-1st-edition-shadowless',nome:'Charizard'}
 const e={tags:[],language:'INT',set_code:'BASE1',collector_number:'4',source_payload:{set:{id:'base1'},variant:{type:'normal',subtype:'shadowless',stamp:['1st-edition']},has_normal_variant:true}}
 const r=resolvePublication(e,{nome:'Charizard'},sets,[existing]);assert.equal(r.row.variante,existing.variante);assert.equal(r.created,undefined)
 assert.equal(variantKey({type:'normal',stamp:[{}]},true),null)
})

import {timestampMicros} from '../scripts/publish-bindex.mjs'
test('publication cursor preserves Postgres microseconds',()=>{assert.ok(timestampMicros('2026-11-14T12:00:00.123456+00:00')>timestampMicros('2026-11-14T12:00:00.123123+00:00'));assert.equal(timestampMicros('2026-11-14T12:00:00.123Z'),timestampMicros('2026-11-14T12:00:00.123000+00:00'))})

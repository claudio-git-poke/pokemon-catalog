import {test} from 'node:test'
import assert from 'node:assert/strict'
import {atlasMetadataEntry,enrichAtlasMetadata} from '../scripts/atlas-metadata.mjs'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {postgresClient} from './helpers/postgres-client.mjs'
const card={id:1,nome:'악비르',sigla:'SV1S@KOR',lingua:'KOR',source_uid:'atlas:ko:SV1S-043',source_card_id:'SV1S-043',source_language:'ko',source_local_id:'043'}
const detail={id:'SV1S-043',localId:'043',name:'악비르',localLanguage:'KOR',sourcePage:'https://pokemoncard.co.kr/cards/detail/BS2023006043',metadata:{rarity:'C',card_type:'Pokémon',types:['Fighting'],regulation:'G',set_total:'078'}}
const set={set_id:'SV1S',source_language:'ko'}
test('regional metadata remains searchable without inventing foil, stamps or a verified scan',()=>{
 const e=atlasMetadataEntry(card,detail,set)
 assert.ok(e.tags.includes('rarity:c'));assert.ok(e.tags.includes('type:fighting'))
 assert.equal(e.collector_number,'43');assert.equal(e.denominator,'78');assert.equal(e.facts.asian_script,true)
 assert.equal(e.facts.shiny,undefined);assert.equal(e.facts.extra_mark,undefined);assert.equal(e.image_url,null)
 assert.ok(!e.tags.some(t=>/^(finish|pattern|stamp):/.test(t)))
 assert.equal(e.source_payload.metadata_scope,'card-metadata-only')
})
test('source, regional language, number and official URL mismatches are rejected',()=>{
 for(const patch of [{lingua:'JP'},{source_uid:'tcgdex:ko:SV1S-043'},{source_card_id:'SV1S-044'},{source_local_id:'044'},{sigla:'SV1V@KOR'}])assert.throws(()=>atlasMetadataEntry({...card,...patch},detail,set))
 assert.throws(()=>atlasMetadataEntry(card,{...detail,sourcePage:'https://example.com/card'},set))
})
test('rarity never establishes shiny and each regional card keeps its own entry',()=>{
 const e=atlasMetadataEntry(card,{...detail,name:'포켓몬ex',metadata:{...detail.metadata,rarity:'SAR'}},set)
 assert.ok(e.tags.includes('category:ex'));assert.equal(e.facts.name_has_ex,true)
 assert.equal(e.facts.shiny,undefined)
 assert.notEqual(e.entry_key,atlasMetadataEntry({...card,id:2},detail,set).entry_key)
})
test('historical Atlas metadata is persisted once without changing source identity or image',async()=>{
 const pg=new PGlite()
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role;
  create table cards(id bigint primary key,nome text,sigla text,lingua text,source_uid text,source_card_id text,source_language text,source_local_id text,numero int,codice text,image_url text,image_status text);`)
  await pg.exec(await readFile(new URL('../db/catalog-identification.sql',import.meta.url),'utf8'))
  await pg.exec(`insert into cards values(1,'악비르','SV1S@KOR','KOR','atlas:ko:SV1S-043','SV1S-043','ko','043',43,null,'manual-photo','manual',null,now(),null)`)
  const db=postgresClient(pg),options={db,root:'unused',log:async()=>{},loadSets:async()=>[set],loadCards:async()=>[detail]}
  assert.equal((await enrichAtlasMetadata(options)).checked,1)
  assert.equal((await enrichAtlasMetadata(options)).attempted,0)
  const saved=(await pg.query("select * from catalog_search_entries where entry_key='atlas-metadata:1'")).rows[0]
  assert.ok(saved.tags.includes('type:fighting'));assert.equal(saved.image_url,null)
  const c=(await pg.query('select * from cards')).rows[0]
  assert.equal(c.source_uid,card.source_uid);assert.equal(c.image_url,'manual-photo');assert.ok(c.traits_checked_at)
 }finally{await pg.close()}
})

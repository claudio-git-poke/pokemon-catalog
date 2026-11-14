import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {mapVariant,termsForEntries} from '../scripts/variant-mappings.mjs'
import {detailEntries} from '../scripts/enrich-catalog.mjs'
import {deckEntry} from '../scripts/deck-mappings.mjs'
import {parseIdentificationQuery} from '../src/lib/catalog-identification.ts'
import {TAXONOMY} from '../src/lib/catalog-taxonomy.ts'
test('every currently documented upstream variant dimension has a canonical term',async()=>{
 const text=await readFile(new URL('../scripts/sources/tcgdex-variant-types.d.ts',import.meta.url),'utf8')
 const sections=[['stamp',text.split('export type VariantStamps =')[1].split('export interface variant_detailed')[0]],['subtype',text.split('subtype?:')[1].split('/**')[0]],['pattern',text.split('foil?:')[1].split('/**')[0]],['finish',text.split('export type VariantType =')[1].split('export type VariantStamps')[0]]]
 for(const[kind,s]of sections)for(const [,id]of s.matchAll(/['"]([a-z0-9-]+)['"]/g))assert.ok(TAXONOMY.some(t=>t.code===`${kind}:${id}`),`${kind}:${id}`)
 assert.deepEqual(JSON.parse(await readFile(new URL('../data/catalog-taxonomy.json',import.meta.url),'utf8')),TAXONOMY)
})
test('WCD requires signature plus event; Cosmos aliases, sizes and future raw variants remain searchable',()=>{
 const card={id:1,nome:'Pikachu',lingua:'INT',source_language:'en'}
 assert.ok(!mapVariant(card,{}, {stamp:['worlds-2004']}).tags.includes('family:world-championships'))
 const wcd=mapVariant(card,{}, {type:'normal',stamp:['worlds-2004','chris-fulop']});assert.ok(wcd.tags.includes('family:world-championships'));assert.equal(wcd.attributes.release_year,2004);assert.equal(wcd.facts.printed_signature_visible,true)
 assert.ok(mapVariant(card,{}, {type:'holo',foil:'galaxy'}).tags.includes('pattern:cosmos'))
 assert.equal(mapVariant(card,{}, {type:'normal',foil:'cosmos'}).facts.shiny,undefined)
 const fresh=termsForEntries([{tags:['pattern:new-pattern-2030']}]);assert.deepEqual(parseIdentificationQuery('new pattern 2030',fresh).tags,['pattern:new-pattern-2030'])
 assert.equal(detailEntries({...card,sigla:'MFB'},{id:'mfb-1',localId:'1',set:{id:'mfb',cardCount:{official:48}},variants:[{type:'normal',stamp:['bulbasaur']} ]})[0].collector_number,null)
})
test('all six numbered international BA decks cover positions 1–60 exactly; advanced decks are unnumbered',async()=>{
 const rows=JSON.parse(await readFile(new URL('../data/catalog-decks.json',import.meta.url),'utf8'))
 for(const year of [2020,2022,2024]){const numbered=rows.filter(r=>r.year===year&&r.deck_number!==null);assert.equal(numbered.length,120);for(const deck of new Set(numbered.map(r=>r.deck)))assert.deepEqual(numbered.filter(r=>r.deck===deck).map(r=>r.deck_number).sort((a,b)=>a-b),Array.from({length:60},(_,i)=>i+1))}
 const row=rows.find(r=>r.year===2024&&r.deck==='pikachu'&&r.deck_number===2),entry=deckEntry({id:1,nome:row.name,sigla:'SVP',lingua:'INT'},row)
 assert.equal(entry.collector_number,'107');assert.equal(entry.deck_number,2);assert.equal(entry.facts.deck_number_visible,true)
 assert.equal(deckEntry({id:2,nome:'X',sigla:'X',lingua:'INT'},rows.find(r=>r.deck_number===null)).facts.deck_number_visible,false)
 assert.ok(parseIdentificationQuery('BA 52').tags.includes('family:battle-academy'))
})
test('legacy variant flags preserve availability without inventing finish combinations',()=>{
 const rows=detailEntries({id:2,nome:'Pikachu',sigla:'BASE1',lingua:'INT',source_language:'en'},{id:'base1-58',localId:'58',variants:{normal:true,holo:true,firstEdition:true,jumbo:true}})
 assert.equal(rows.length,4)
 const first=rows.find(r=>r.tags.includes('stamp:1st-edition'));assert.equal(first.facts.shiny,undefined);assert.ok(!first.tags.includes('finish:holo'))
 assert.equal(rows.find(r=>r.tags.includes('size:jumbo')).facts.oversized,true)
})

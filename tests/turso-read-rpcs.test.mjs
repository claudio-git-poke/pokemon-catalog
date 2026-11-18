import {test} from 'node:test'
import assert from 'node:assert/strict'
import {catalogFixture} from './helpers/turso-fixture.mjs'
import {identifyCards,bindexExportPage,bindexPrintingPage,bindexContractReport} from '../src/server/turso-read-rpcs.mjs'
import {utcTimestamp,utcSortSql,normalizeCatalog} from '../src/server/turso-values.mjs'
test('identification preserves matching-printing fallback, ranking and unknown facts without inventing evidence',async()=>{
 const c=await catalogFixture({cards:[1,2,3].map(id=>({id,file_name:id+'.png',nome:'Iono '+id,lingua:'INT',sigla:'SV02',numero:269,manual_overrides:{},image_status:'missing'})),catalog_search_entries:[{entry_key:'card:1',card_id:1,name:'Iono 1',collector_number:'269',language:'INT',verification:'catalog',tags:['rarity:special-illustration-rare'],facts:{shiny:true},manual_overrides:{},search_text:'iono 269'},{entry_key:'variant:1',card_id:1,name:'Iono 1 foil',collector_number:'269',language:'INT',verification:'source',tags:['rarity:special-illustration-rare'],facts:{shiny:false},manual_overrides:{},search_text:'iono 269 foil'},{entry_key:'card:2',card_id:2,name:'Iono 2',collector_number:'269',language:'INT',verification:'catalog',tags:['rarity:rare'],facts:{shiny:1},manual_overrides:{},search_text:'iono 269'},{entry_key:'card:3',card_id:3,name:'Iono 3',collector_number:'269',language:'INT',verification:'catalog',tags:['rarity:special-illustration-rare'],facts:{},manual_overrides:{},search_text:'iono 269'}]})
 const query={tokens:['ion'],required_tags:['rarity:special-illustration-rare'],observations:{shiny:true},card_number:'000269',wanted_language:'INT'}
 const result=await identifyCards(c,query);assert.equal(result.total,2);assert.equal(result.results[0].entry_key,'card:3');assert.equal(result.results[0].unknown,1);assert.equal(result.results[1].entry_key,'variant:1');assert.equal(result.results[1].contradicted,1);assert.ok(!result.results[0].source_payload);assert.ok(!result.results.some(r=>r.entry_key==='card:1'))
 const emptyPage=await identifyCards(c,{...query,page_offset:20});assert.equal(emptyPage.total,2);assert.deepEqual(emptyPage.results,[])
 const none=await identifyCards(c,{required_tags:['type:absent']});assert.equal(none.total,0)
 const numeric=await identifyCards(c,{required_tags:['rarity:rare'],observations:{shiny:true}});assert.equal(numeric.results[0].matched,0);assert.equal(numeric.results[0].contradicted,1)
 c.close()
})
test('incremental Bindex feeds retain full composite keys and microsecond boundaries across UTC offsets',async()=>{
 const times=['2026-11-17T12:00:00.000001+00:00','2026-11-17T12:00:00.000001Z','2026-11-17T12:00:00.000002+00:00','2026-11-17T13:00:00.000003+01:00']
 const c=await catalogFixture({set_carte:times.map((time,i)=>({sigla:'SV02',numero:i+1,variante:'normal',nome:'Card '+i,codice:'SV02',tag:[],aggiornato_il:time,eliminata:false,manual_overrides:{}})),catalog_printing_inventory:times.slice(0,2).map((time,i)=>({record_key:'source:'+i,updated_at:time,scope:'printing',canonical_sigla:i===0?'SV02':null,canonical_numero:i===0?1:null,canonical_variante:i===0?'normal':null,canonical_mapping_status:i===0?'mapped':'pending',deleted:false,manual_overrides:{}}))})
 const now=Date.parse('2026-11-17T14:00:00Z'),first=await bindexExportPage(c,{page_size:2},now)
 assert.equal(first.items.length,2);assert.deepEqual(first.next_cursor.key,['SV02',2,'normal']);assert.equal(first.complete,false);assert.equal(first.items[0].eliminata,false)
 const next=await bindexExportPage(c,{after_time:first.next_cursor.time,after_key:first.next_cursor.key,page_size:2,until_time:first.until},now);assert.deepEqual(next.items.map(r=>r.numero),[3,4])
 const end=await bindexExportPage(c,{after_time:next.next_cursor.time,after_key:next.next_cursor.key,page_size:2,until_time:first.until},now);assert.equal(end.complete,true);assert.equal(end.items.length,0)
 const inventory=await bindexPrintingPage(c,{page_size:1},now);assert.deepEqual(inventory.items[0].canonical_key,{sigla:'SV02',numero:1,variante:'normal'});assert.ok(!Object.hasOwn(inventory.items[0],'canonical_sigla'));assert.equal(inventory.complete,false)
 const inventoryNext=await bindexPrintingPage(c,{after_time:inventory.next_cursor.time,after_key:inventory.next_cursor.key},now);assert.equal(inventoryNext.items[0].canonical_key,null)
 assert.equal(utcTimestamp(times[3]),'2026-11-17T12:00:00.000003Z');assert.equal(utcTimestamp('2026-11-17T23:59:59.999999Z'),'2026-11-17T23:59:59.999999Z')
 const expression=utcSortSql('?'),argumentsCount=[...expression.matchAll(/\?/g)].length
 assert.equal((await c.execute({sql:'SELECT '+expression+' normalized',args:Array(argumentsCount).fill(times[3])})).rows[0].normalized,'2026-11-17T12:00:00.000003Z')
 assert.equal(normalizeCatalog('エネルギー'),'エネルギー');c.close()
})
test('contract validation preserves code, variant and canonical market-page checks',async()=>{
 const c=await catalogFixture({set_carte:[{sigla:'SV02',numero:1,variante:'normal',nome:'Valid',codice:'SV-P EN',cardmarket_url:'https://www.cardmarket.com/it/Pokemon/Products/Singles/Valid',manual_overrides:{}},{sigla:'SV02',numero:2,variante:'bad--variant',nome:'Bad',codice:'SV02',manual_overrides:{}},{sigla:'SV02',numero:3,variante:'normal',nome:'Bad',codice:'lowercase',manual_overrides:{}},{sigla:'SV02',numero:4,variante:'normal',nome:'Bad',codice:null,cardmarket_url:'https://www.cardmarket.com/it/Pokemon/Products/Singles/Valid?tracking=1',manual_overrides:{}}]})
 const report=await bindexContractReport(c);assert.equal(report.cards,4);assert.equal(report.blocking,3);assert.equal(report.missing_code,1);assert.equal(report.canonical_cardmarket_pages,2);c.close()
})
test('incremental Bindex feeds page through modification-time indexes instead of sorting whole tables',async()=>{
 const {bindexExportPage:page}=await import('../src/server/turso-read-rpcs.mjs')
 const c=await catalogFixture({set_carte:[{sigla:'SV02',numero:1,variante:'normal',nome:'A',codice:'SV02',tag:[],aggiornato_il:'2026-11-17T12:00:00+00:00',eliminata:false,manual_overrides:{}}]})
 const plans=[],spy={execute:async input=>{const {sql,args=[]}=typeof input==='string'?{sql:input}:input;plans.push(...(await c.execute({sql:'EXPLAIN QUERY PLAN '+sql,args})).rows.map(r=>r.detail));return c.execute(input)}}
 const now=Date.parse('2026-11-17T14:00:00Z')
 for(const kind of ['cards','sets','photos'])await page(spy,{kind,page_size:10},now)
 await bindexPrintingPage(spy,{page_size:10},now)
 for(const index of ['_catalog_feed_set_carte','_catalog_feed_set_espansioni','_catalog_feed_set_carte_immagini','_catalog_feed_printing_inventory'])assert.ok(plans.some(d=>d.includes(index)),index+' non usato: '+plans.join(' | '))
 assert.ok(!plans.some(d=>/TEMP B-TREE FOR ORDER BY/.test(d)),'nessun ordinamento completo: '+plans.join(' | '))
 c.close()
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {catalogFixture,putRow} from './helpers/turso-fixture.mjs'
import {visualCards,visualGroupCards,visualGroupPage,visualLanguage} from '../src/server/turso-visual.mjs'
import {visualGroupKey} from '../src/server/turso-schema.mjs'
const asset=(key,patch)=>({asset_key:key,kind:'rarity',scope:'physical',availability:'available',source_language:'en',source_code:key,name:key,image_sha256:key,manual_overrides:{},tag_codes:[],...patch})
const cards=[1,2,3,4,5,6].map(id=>({id,nome:'Card '+id,file_name:id+'.png',source_uid:id===3?'tcgdex:ja:sv2a-1':id===5?'tcgdex:it:sv02-5':id===6?'tcgdex:en:base1-1':'tcgdex:en:sv02-'+id,source_language:id===3?'ja':id===5?'it':'en',lingua:id===3?'JP':id===5?'IT':'INT',sigla:'SV02',image_status:'missing',manual_overrides:{}}))
const entries=[1,2,3,5,6].map(id=>({entry_key:'card:'+id,card_id:id,name:'Card '+id,language:id===3?'JP':id===5?'IT':'INT',set_code:'SV02',verification:'catalog',tags:[id===3?'rarity:r':'rarity:rare'],facts:{},source_payload:{},manual_overrides:{},search_text:'card '+id}))
entries.push({entry_key:'tcgdex:2:foil',card_id:2,name:'Card 2 foil',language:'INT',set_code:'SV02',verification:'source',tags:['rarity:rare'],facts:{},source_payload:{source_language:'en',variant:{type:'foil'}},manual_overrides:{},search_text:'card 2 foil'})
entries.push({entry_key:'trick-or-trade-2023:4:normal',card_id:4,name:'Card 4',language:'INT',set_code:'SV02',release_code:'trick-or-trade-2023',release_year:2023,verification:'source',tags:['stamp:trick-or-trade'],facts:{},source_payload:{},manual_overrides:{},search_text:'trick or trade 2023'})
const symbols=[asset('rare-en',{match_mode:'tag',tag_codes:['rarity:rare']}),asset('rare-neutral',{source_language:'und',match_mode:'tag',tag_codes:['rarity:rare','rarity:r']}),asset('set-en',{kind:'set_symbol',source_code:'sv02',match_mode:'tcgdex-set',image_sha256:'set-image'}),asset('set-neutral',{kind:'set_symbol',source_code:'external',match_code:'sv02',source_language:'und',match_mode:'tcgdex-set',image_sha256:'set-image'}),asset('trick',{kind:'promo_stamp',match_mode:'tag',tag_codes:['stamp:trick-or-trade']}),asset('base',{kind:'set_symbol',source_code:'base1',match_mode:'tcgdex-set'})]
const fixture=()=>catalogFixture({cards,catalog_search_entries:entries,catalog_visual_assets:symbols})
test('symbol fallback retains generic-only cards and excludes a generic only when a matching printing exists',async()=>{
 const c=await fixture(),result=await visualCards(c,{symbol_key:'set-en',page_size:100})
 assert.ok(result.results.some(r=>r.entry_key==='card:1'));assert.ok(result.results.some(r=>r.entry_key==='tcgdex:2:foil'));assert.ok(!result.results.some(r=>r.entry_key==='card:2'));assert.ok(!result.results.some(r=>r.card_id===5))
 assert.ok(result.results.every(r=>r.image_match_status==='candidate'))
 await c.batch(["UPDATE _catalog_write_context SET mode='automatic' WHERE id=1","UPDATE _copy_catalog_search_entries SET _row=json_set(_row,'$.tags',json_array('rarity:common')) WHERE _key='[\"tcgdex:2:foil\"]'","UPDATE _catalog_write_context SET mode='manual' WHERE id=1"])
 const rarity=await visualCards(c,{symbol_key:'rare-en',page_size:100});assert.ok(rarity.results.some(r=>r.entry_key==='card:2'),'a nonmatching variant must not hide the generic rarity')
 const base=await visualCards(c,{symbol_key:'base'});assert.equal(base.results.length,0)
 c.close()
})
test('language-neutral rules span languages and release-language fallback includes special English printings',async()=>{
 const c=await fixture(),rare=await visualCards(c,{symbol_key:'rare-neutral',page_size:100})
 for(const lang of ['en','it','ja'])assert.ok(rare.results.some(r=>r.actual_language===lang),lang)
 const neutral=await visualCards(c,{symbol_key:'set-neutral',page_size:100});assert.ok(neutral.results.some(r=>r.card_id===5))
 const trick=await visualCards(c,{symbol_key:'trick'});assert.equal(trick.results.length,1);assert.equal(trick.results[0].actual_language,'en');assert.equal(trick.results[0].release_year,2023)
 assert.equal(visualLanguage('CHN-T'),'zh-tw');assert.equal(visualLanguage('JP'),'ja');c.close()
})
test('rejections block individual and grouped results without resurrecting a generic fallback',async()=>{
 const c=await fixture();await putRow(c,'catalog_visual_links',{asset_key:'set-en',entry_key:'tcgdex:2:foil',status:'rejected',image_match_status:'candidate',manual_overrides:{}},'manual')
 const key=visualGroupKey(symbols.find(a=>a.asset_key==='set-en'))
 for(const result of [await visualCards(c,{symbol_key:'set-en',page_size:100}),await visualGroupCards(c,{symbol_group:key,page_size:100})])assert.ok(!result.results.some(r=>r.card_id===2))
 const group=await visualGroupPage(c,{filter_kind:'set_symbol',filter_language:'it'});assert.ok(group.results.some(r=>r.group_key===key&&r.languages.includes('und')))
 const first=await visualGroupCards(c,{symbol_group:key,page_size:1});assert.equal(first.results.length,1);assert.equal(first.has_more,true)
 const next=await visualGroupCards(c,{symbol_group:key,page_size:100,after_key:first.next_key});assert.ok(next.results.every(r=>r.entry_key>first.next_key))
 c.close()
})

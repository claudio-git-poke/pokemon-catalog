import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {parseIdentificationQuery,validateObservations,sourcePrinting} from '../src/lib/catalog-identification.ts'
import {detailEntries} from '../scripts/enrich-catalog.mjs'
test('aliases resolve families and patterns without requiring year or vendor title',()=>{
 assert.deepEqual(parseIdentificationQuery('BOO 052').tags,['family:trick-or-trade'])
 assert.equal(parseIdentificationQuery('boo 052').number,'52')
 assert.equal(parseIdentificationQuery('boo 2023').year,2023)
 assert.equal(parseIdentificationQuery('cosmo holo').tags[0],'pattern:cosmos')
 assert.equal(parseIdentificationQuery('holo').tags[0],'visual:shiny')
 assert.equal(parseIdentificationQuery('Pikachu 052/198').denominator,'198')
 assert.deepEqual(parseIdentificationQuery('booster bundle').tags,[])
 assert.equal(validateObservations({shiny:false,mark_top_left:null,invented:true}).shiny,false)
 assert.equal(validateObservations({invented:true}).invented,undefined)
})
test('source variants remain distinct and unreported observations stay unknown',()=>{
 const rows=detailEntries({id:1,nome:'Bulbasaur',sigla:'MFB',lingua:'INT',source_language:'en'},{id:'mfb-1',localId:'1',variants_detailed:[{type:'normal',variantId:'a',stamp:['bulbasaur']},{type:'normal',variantId:'b',subtype:'blue-border',stamp:['bulbasaur','pokeball']}]})
 assert.notEqual(rows[0].entry_key,rows[1].entry_key)
 assert.equal(rows[0].facts.blue_border_visible,undefined)
 assert.equal(rows[1].facts.blue_border_visible,true)
 assert.equal(rows[1].facts.mark_bottom_right,undefined)
 assert.ok(sourcePrinting({type:'reverse',foil:'cosmos'}).tags.includes('visual:shiny'))
 assert.ok(!sourcePrinting({type:'holo',stamp:['worlds-2024']}).tags.includes('family:world-championships'))
})
test('database search matches BOO across years, broad holo, unknowns, and one coherent variant at a time',async()=>{
 const pg=new PGlite()
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create table cards(id bigint primary key,nome text,sigla text,lingua text,numero integer,codice text,source_local_id text,source_card_id text,image_url text,image_status text);
  insert into cards values(1,'Pikachu','MFB','INT',29,'MFB',null,null,null,'missing'),(2,'Gengar','SWSH11@INT','INT',52,'swsh11 52','052','swsh11-052',null,'missing');
  grant select on cards to anon;`)
  await pg.exec(await readFile(new URL('../db/catalog-identification.sql',import.meta.url),'utf8'))
  await pg.exec(await readFile(new URL('../db/catalog-taxonomy-seed.sql',import.meta.url),'utf8'))
  await pg.exec('alter table cards add column source_uid text')
  await pg.exec(await readFile(new URL('../db/catalog-releases-seed.sql',import.meta.url),'utf8'))
  const insert=`insert into catalog_search_entries(entry_key,card_id,release_code,release_year,collector_number,name,set_code,language,tags,facts,verification,label,search_text) values
  ('boo22',2,'trick-or-trade-2022',2022,'52','Gengar','SWSH11','INT',array['family:trick-or-trade','visual:shiny','pattern:cosmos'],'{"shiny":true,"extra_mark":true}','source','BOO22','gengar swsh11'),
  ('boo23',2,'trick-or-trade-2023',2023,'52','Gengar','SWSH11','INT',array['family:trick-or-trade','visual:shiny'],'{"shiny":true,"extra_mark":true}','source','BOO23','gengar swsh11'),
  ('separate',1,null,null,'1','Pikachu','MFB','INT',array['stamp:staff'],'{"shiny":false}','source','Staff','pikachu mfb');`
  await pg.exec(insert)
  const call=async(params)=> (await pg.query('select identify_catalog_cards($1,$2,$3,$4,$5,$6,$7,$8,$9) result',params)).rows[0].result
  const defaults=[[],['family:trick-or-trade'],'52',null,null,null,{},0,24]
  assert.equal((await call(defaults)).total,2)
  assert.equal((await call([...defaults.slice(0,4),2023,...defaults.slice(5)])).total,1)
  assert.equal((await call([[],['visual:shiny'],null,null,null,null,{},0,24])).total,2)
  const no=await call([[],[],null,null,null,null,{mark_top_left:true},0,24]);assert.ok(no.total>=3);assert.equal(no.results[0].unknown,1)
  assert.equal((await call([[],['pattern:cosmos','stamp:staff'],null,null,null,null,{},0,24])).total,0)
  assert.equal((await call([[],[], '29',null,null,null,{},0,24])).total,0) // Legacy MFB catalogue position is not a printed number.
  await pg.exec("set role anon")
  assert.equal((await call(defaults)).total,2)
  await assert.rejects(pg.exec("insert into catalog_terms(code,label,kind) values('evil','evil','stamp')"),/permission denied/)
 }finally{await pg.close()}
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {initializeSnapshot,copyTable} from '../scripts/turso-snapshot.mjs'
import {readCatalogRows,CatalogRestError} from '../src/server/turso-rest.mjs'
const schema=JSON.parse(readFileSync(new URL('../data/turso-source-schema.json',import.meta.url),'utf8'))
function memoryClient(){const db=new DatabaseSync(':memory:');const c={async execute(input){const {sql,args=[]}=typeof input==='string'?{sql:input}:input;const s=db.prepare(sql);if(s.columns().length)return {rows:s.all(...args)};return {rows:[],rowsAffected:Number(s.run(...args).changes)}},async batch(statements){db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await c.execute(s));db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}},close(){db.close()}};return c}
async function fixture(){
 const c=memoryClient(),tables=schema.tables.filter(t=>['cards','catalog_search_entries','catalog_manual_history'].includes(t.table_name))
 await initializeSnapshot(c,tables,'rest-fixture')
 const data={cards:[{id:1,nome:'Iono',sigla:'SV02@INT',lingua:'INT',numero:269,image_url:'https://example.test/iono.png',image_status:'manual',manual_overrides:{image_url:'https://example.test/iono.png'}},{id:2,nome:'Altro',sigla:'SV02@IT',lingua:'IT',numero:12,image_url:null,image_status:'missing',manual_overrides:{}}],catalog_search_entries:[{entry_key:'card:1',card_id:1,name:'Iono',set_code:'SV02@INT',language:'INT',collector_number:'269',tags:['rarity:special-illustration-rare','type:fire'],facts:{shiny:false},verification:'catalog',source_payload:{set:{name:'Paldea Evolved'},rarity:'Special illustration rare'},search_text:'iono sv02 269'},{entry_key:'card:2',card_id:2,name:'Altro',set_code:'SV02@IT',language:'IT',collector_number:'12',tags:[],facts:{},verification:'catalog',source_payload:{},search_text:'altro sv02 12'}],catalog_manual_history:[{id:1,old_values:{notes:'private'},new_values:{notes:'private'}}]}
 for(const table of tables){const rows=data[table.table_name];await copyTable({client:c,table,source:{async count(){return rows.length},async page(){return rows}}})}
 await c.execute(`CREATE VIRTUAL TABLE _catalog_entry_fts USING fts5(search_text,content='')`)
 await c.execute(`INSERT INTO _catalog_entry_fts(rowid,search_text) SELECT rowid,json_extract(_row,'$.search_text') FROM _copy_catalog_search_entries`)
 await c.execute('CREATE TABLE _catalog_entry_tags(tag TEXT NOT NULL,entry_rowid INTEGER NOT NULL,PRIMARY KEY(tag,entry_rowid)) WITHOUT ROWID')
 await c.execute(`INSERT OR IGNORE INTO _catalog_entry_tags(tag,entry_rowid) SELECT j.value,e.rowid FROM _copy_catalog_search_entries e,json_each(e._row,'$.tags') j WHERE typeof(j.value)='text'`)
 return c
}
test('Turso reads preserve ricercaDB fields, embedded cards, translated JSON and exact counts',async()=>{
 const c=await fixture(),params=new URLSearchParams({select:'entry_key,name,source_payload,set_name:source_payload->set->>name,cards(image_url,link_cardmarket)',or:'(set_code.eq."SV02",set_code.like."SV02@*")',order:'cards(image_url).asc.nullslast,card_id.asc',limit:'200'})
 const result=await readCatalogRows(c,schema,'catalog_search_entries',params,{count:true})
 assert.equal(result.count,2);assert.equal(result.rows[0].entry_key,'card:1');assert.equal(result.rows[0].cards.image_url,'https://example.test/iono.png');assert.equal(result.rows[0].cards.link_cardmarket,null);assert.equal(result.rows[0].set_name,'Paldea Evolved');assert.deepEqual(result.rows[0].source_payload.set,{name:'Paldea Evolved'});assert.equal(result.rows[1].cards.image_url,null)
 c.close()
})
test('array containment, keyset pagination and full text search keep their documented meaning',async()=>{
 const c=await fixture()
 for(const filters of [{tags:'cs.{rarity:special-illustration-rare,type:fire}'},{tags:'ov.{type:water,type:fire}'},{search_vector:'fts(simple).iono&269'},{entry_key:'in.("card:1")'},{name:'ilike.%IONO%'}]){
  const result=await readCatalogRows(c,schema,'catalog_search_entries',new URLSearchParams({select:'entry_key,tags',...filters}));assert.equal(result.rows.length,1);assert.equal(result.rows[0].entry_key,'card:1')
 }
 const next=await readCatalogRows(c,schema,'catalog_search_entries',new URLSearchParams({entry_key:'gt.card:1',select:'entry_key'}));assert.deepEqual(next.rows,[{entry_key:'card:2'}])
 const empty=await readCatalogRows(c,schema,'catalog_search_entries',new URLSearchParams({tags:'cs.{type:water}'}));assert.equal(empty.rows.length,0)
 c.close()
})
test('public query parsing cannot select private tables, unknown fields or inject SQL',async()=>{
 const c=await fixture()
 await assert.rejects(readCatalogRows(c,schema,'catalog_manual_history'),error=>error instanceof CatalogRestError&&error.status===403)
 await assert.rejects(readCatalogRows(c,schema,'cards',new URLSearchParams({select:'id);DROP TABLE cards;--'})),CatalogRestError)
 await assert.rejects(readCatalogRows(c,schema,'cards',new URLSearchParams({order:'id;DROP TABLE cards;--'})),CatalogRestError)
 const result=await readCatalogRows(c,schema,'cards',new URLSearchParams({nome:'eq.\' OR 1=1 --'}));assert.equal(result.rows.length,0)
 assert.equal((await readCatalogRows(c,schema,'cards',new URLSearchParams(),{head:true,count:true})).count,2)
 const original=await readCatalogRows(c,schema,'cards',new URLSearchParams({id:'eq.1'}));assert.deepEqual(original.rows[0].manual_overrides,{image_url:'https://example.test/iono.png'})
 c.close()
})
test('tag filters on printings use the indexed tag table and keep their meaning',async()=>{
 const c=await fixture(),sql=[]
 const spy={execute:async input=>{sql.push(typeof input==='string'?input:input.sql);return c.execute(input)}}
 for(const [filter,expected]of [['ov.{type:water,type:fire}',['card:1']],['cs.{rarity:special-illustration-rare,type:fire}',['card:1']],['cs.{type:fire,type:water}',[]],['not.ov.{type:fire}',['card:2']]]){
  const rows=(await readCatalogRows(spy,schema,'catalog_search_entries',new URLSearchParams({select:'entry_key',tags:filter,order:'entry_key.asc'}))).rows.map(r=>r.entry_key)
  assert.deepEqual(rows,expected,filter)
 }
 assert.ok(sql.every(q=>q.includes('_catalog_entry_tags')&&!q.includes('json_each(json_extract(e._row')))
 c.close()
})

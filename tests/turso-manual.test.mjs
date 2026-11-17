import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {initializeSnapshot,copyTable} from '../scripts/turso-snapshot.mjs'
import {prepareCatalogSchema} from '../src/server/turso-schema.mjs'
const schema=JSON.parse(readFileSync(new URL('../data/turso-source-schema.json',import.meta.url),'utf8'))
function memoryClient(){const db=new DatabaseSync(':memory:');const c={async execute(input){const {sql,args=[]}=typeof input==='string'?{sql:input}:input;const s=db.prepare(sql);if(s.columns().length)return {rows:s.all(...args)};return {rows:[],rowsAffected:Number(s.run(...args).changes)}},async batch(statements){db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await c.execute(s));db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}},close(){db.close()}};return c}
function rowFor(name,patch){return {...Object.fromEntries(schema.tables.find(t=>t.table_name===name).columns.map(c=>[c.name,c.nullable?null:c.type.endsWith('[]')?[]:c.type==='jsonb'?{}:c.type==='boolean'?false:/^(bigint|integer|smallint)/.test(c.type)?0:''])),...patch}}
async function fixture(){
 const c=memoryClient();await initializeSnapshot(c,schema.tables,'manual-fixture')
 const data={cards:[rowFor('cards',{id:1,file_name:'one.png',nome:'Prima',sigla:'SV02@INT',lingua:'INT',numero:269,variante:'normal',image_url:'https://example.test/one.png',image_status:'found',image_source:'source',notes:'Memo',manual_overrides:{}})],catalog_search_entries:[rowFor('catalog_search_entries',{entry_key:'card:1',card_id:1,name:'Prima',set_code:'SV02@INT',language:'INT',verification:'catalog',tags:['rarity:rare'],facts:{},source_payload:{},manual_overrides:{},search_text:'prima sv02 269'}),rowFor('catalog_search_entries',{entry_key:'tcgdex:1:normal',card_id:1,name:'Nome scelto',set_code:'SV02@INT',language:'INT',verification:'source',tags:[],facts:{},source_payload:{},manual_overrides:{name:'Nome scelto',tags:[]},search_text:'nome scelto sv02'})]}
 for(const table of schema.tables){const rows=data[table.table_name]||[];await copyTable({client:c,table,source:{async count(){return rows.length},async page(){return rows}}})}
 await c.execute('UPDATE _catalog_snapshot_meta SET complete=1 WHERE id=1');await prepareCatalogSchema(c,schema)
 return c
}
async function card(c){return JSON.parse((await c.execute('SELECT _row FROM _copy_cards')).rows[0]._row)}
async function automatic(c,sql){return c.batch(["UPDATE _catalog_write_context SET mode='automatic' WHERE id=1",sql,"UPDATE _catalog_write_context SET mode='manual' WHERE id=1"])}
test('direct SQL edits capture null/empty choices and automatic writes cannot erase locks or their history',async()=>{
 const c=await fixture()
 await automatic(c,'DELETE FROM _copy_cards');assert.equal((await c.execute('SELECT count(*) n FROM _copy_cards')).rows[0].n,1,'protected child preserves parent')
 await c.execute("UPDATE cards SET notes=NULL,image_url=NULL,image_status='manual',image_source='manual' WHERE id=1")
 let saved=await card(c);assert.equal(saved.notes,null);assert.equal(saved.manual_overrides.notes,null);assert.equal(saved.manual_overrides.image_url,null);assert.equal(saved.manual_overrides.image_status,'manual')
 const history=(await c.execute('SELECT _row FROM _copy_catalog_manual_history')).rows.map(r=>JSON.parse(r._row));assert.equal(history.length,1);assert.equal(history[0].before_values.notes,'Memo');assert.equal(history[0].after_values.notes,null);assert.deepEqual(history[0].record_key,{id:1})
 await automatic(c,"UPDATE _copy_cards SET _row=json_set(_row,'$.notes','automatic','$.image_url','https://example.test/replacement','$.manual_overrides',json('{}'),'$.image_attempts',5)")
 saved=await card(c);assert.equal(saved.notes,null);assert.equal(saved.image_url,null);assert.equal(saved.image_attempts,5);assert.equal(saved.manual_overrides.notes,null)
 assert.equal((await c.execute('SELECT count(*) n FROM _copy_catalog_manual_history')).rows[0].n,1)
 await assert.rejects(c.execute("UPDATE _copy_catalog_manual_history SET _row='{}'"),/append-only/)
 await assert.rejects(c.execute('DELETE FROM _copy_catalog_manual_history'),/append-only/)
 c.close()
})
test('parent manual names reach generic search entries while printing-specific choices and indexes remain authoritative',async()=>{
 const c=await fixture();await c.execute("UPDATE cards SET nome='Cambiato' WHERE id=1")
 const rows=(await c.execute('SELECT _row FROM _copy_catalog_search_entries ORDER BY _key')).rows.map(r=>JSON.parse(r._row))
 assert.equal(rows[0].name,'Cambiato');assert.equal(rows[1].name,'Nome scelto');assert.deepEqual(rows[1].tags,[])
 await automatic(c,"UPDATE _copy_catalog_search_entries SET _row=json_set(_row,'$.name','Fonte','$.tags',json_array('type:fire'),'$.search_text','tokenerrato') WHERE _key='[\"tcgdex:1:normal\"]'")
 const variant=JSON.parse((await c.execute("SELECT _row FROM _copy_catalog_search_entries WHERE _key='[\"tcgdex:1:normal\"]'")).rows[0]._row)
 assert.equal(variant.name,'Nome scelto');assert.deepEqual(variant.tags,[])
 assert.equal((await c.execute("SELECT count(*) n FROM _catalog_entry_tags WHERE tag='type:fire'")).rows[0].n,0)
 assert.equal((await c.execute("SELECT count(*) n FROM _catalog_entry_fts WHERE _catalog_entry_fts MATCH 'tokenerrato'")).rows[0].n,0)
 assert.equal((await c.execute("SELECT count(*) n FROM _catalog_entry_fts WHERE _catalog_entry_fts MATCH 'cambiato'")).rows[0].n,1)
 assert.equal((await c.execute("SELECT count(*) n FROM _catalog_entry_fts WHERE _catalog_entry_fts MATCH 'scelto'")).rows[0].n,1)
 c.close()
})
test('invalid required values roll back automatic context, document changes and derived indexes together',async()=>{
 const c=await fixture(),before=await card(c)
 await assert.rejects(automatic(c,"UPDATE _copy_cards SET _row=json_set(_row,'$.file_name',NULL)"),/obbligatorio/)
 assert.deepEqual(await card(c),before);assert.equal((await c.execute('SELECT mode,depth FROM _catalog_write_context')).rows[0].mode,'manual')
 assert.equal((await c.execute('SELECT count(*) n FROM _copy_catalog_manual_history')).rows[0].n,0)
 c.close()
})
test('new manual empty arrays and empty JSON objects remain typed, protected and present in the audit',async()=>{
 const c=await fixture()
 await automatic(c,"UPDATE _copy_catalog_search_entries SET _row=json_set(_row,'$.source_payload',json_object('rarity','Rare')) WHERE _key='[\"card:1\"]'")
 await c.execute("UPDATE catalog_search_entries SET tags=json_array(),source_payload=json_object() WHERE entry_key='card:1'")
 let row=JSON.parse((await c.execute("SELECT _row FROM _copy_catalog_search_entries WHERE _key='[\"card:1\"]'")).rows[0]._row)
 assert.deepEqual(row.manual_overrides.tags,[]);assert.deepEqual(row.manual_overrides.source_payload,{})
 await automatic(c,"UPDATE _copy_catalog_search_entries SET _row=json_set(_row,'$.tags',json_array('type:fire'),'$.source_payload',json_object('rarity','New')) WHERE _key='[\"card:1\"]'")
 row=JSON.parse((await c.execute("SELECT _row FROM _copy_catalog_search_entries WHERE _key='[\"card:1\"]'")).rows[0]._row)
 assert.deepEqual(row.tags,[]);assert.deepEqual(row.source_payload,{})
 const audit=JSON.parse((await c.execute('SELECT _row FROM _copy_catalog_manual_history ORDER BY _position DESC LIMIT 1')).rows[0]._row)
 assert.deepEqual(audit.after_values.tags,[]);assert.deepEqual(audit.new_overrides.source_payload,{})
 c.close()
})

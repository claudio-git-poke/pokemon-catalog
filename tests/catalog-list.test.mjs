import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {initializeSnapshot,copyTable} from '../scripts/turso-snapshot.mjs'
import {prepareCatalogSchema} from '../src/server/turso-schema.mjs'
import {listCatalog,buildQueries,readFilters,yearCodes} from '../src/server/catalog-list.mjs'
const schema=JSON.parse(readFileSync(new URL('../data/turso-source-schema.json',import.meta.url),'utf8'))
function memoryClient(){const db=new DatabaseSync(':memory:');return {db,async execute(input){const {sql,args=[]}=typeof input==='string'?{sql:input}:input;const s=db.prepare(sql);if(s.columns().length)return {rows:s.all(...args)};const r=s.run(...args);return {rows:[],rowsAffected:r.changes}},async batch(list){for(const q of list)await this.execute(q)},close(){db.close()}}}
const rowFor=(name,patch)=>({...Object.fromEntries(schema.tables.find(t=>t.table_name===name).columns.map(c=>[c.name,c.nullable?null:c.type.endsWith('[]')?[]:c.type==='jsonb'?{}:c.type==='boolean'?false:/^(bigint|integer|smallint|numeric)/.test(c.type)?0:c.type.startsWith('timestamp')?'2026-01-01T00:00:00Z':'x'])),...patch})
async function fixture(){
 const c=memoryClient();await initializeSnapshot(c,schema.tables,'list')
 const cards=[
  rowFor('cards',{id:1,file_name:'a.png',nome:'Budew',sigla:'SV08@INT',lingua:'INT',numero:12,variante:'normale',image_status:'found',image_url:'x',manual_overrides:{}}),
  rowFor('cards',{id:2,file_name:'b.png',nome:'Budew',sigla:'SSP@DE',lingua:'DE',numero:12,variante:'normale',image_status:'placeholder',image_url:null,manual_overrides:{}}),
  rowFor('cards',{id:3,file_name:'c.png',nome:'Pikachu',sigla:'BASE1@IT',lingua:'IT',numero:58,variante:'normale',image_status:'found',image_url:'y',manual_overrides:{}})]
 const entries=[rowFor('catalog_search_entries',{entry_key:'card:1',card_id:1,tags:['rarity:common','stage:basic'],verification:'catalog'}),rowFor('catalog_search_entries',{entry_key:'twin:2',card_id:2,tags:['rarity:haufig','stage:basis'],verification:'catalog'}),rowFor('catalog_search_entries',{entry_key:'card:3',card_id:3,tags:['rarity:comune','stage:base','type:lampo'],verification:'catalog'})]
 for(const table of schema.tables){const rows=table.table_name==='cards'?cards:table.table_name==='catalog_search_entries'?entries:[];await copyTable({client:c,table,pageSize:1000,source:{async count(){return rows.length},async page(t,cursor){return cursor?[]:rows}}})}
 await c.execute('UPDATE _catalog_snapshot_meta SET complete=1 WHERE id=1');await prepareCatalogSchema(c,schema);return c
}
const sheets={'SV08@INT':{release_date:'2024-11-08',abbreviation:'SSP'},'BASE1@INT':{release_date:'1999-01-09'}}
test('metadata filters match every language variant, years use the set sheets, counts come from one grouped query',async()=>{
 const c=await fixture(),years=yearCodes(sheets),list=p=>listCatalog(c,readFilters(new URLSearchParams(p)),{years,ttl:0})
 assert.ok(years.get('2024').has('SSP@DE')&&years.get('1999').has('BASE1@IT'))
 const all=await list('');assert.deepEqual(all.counts,{total:3,with:2,missing:1})
 assert.deepEqual((await list('stadio=basic')).cards.map(x=>x.id).sort(),[1,2,3],'basic, basis and base are the same stage')
 assert.deepEqual((await list('rarita=common&lingua=DE')).cards.map(x=>x.id),[2])
 assert.deepEqual((await list('tipo=lightning')).cards.map(x=>x.id),[3])
 assert.deepEqual((await list('anno=2024')).cards.map(x=>x.id).sort(),[1,2])
 assert.deepEqual((await list('anno=2024&foto=missing')).cards.map(x=>x.id),[2])
 assert.deepEqual((await list('set=base1@it')).cards.map(x=>x.id),[3])
 const plan=(await c.execute({sql:'EXPLAIN QUERY PLAN '+buildQueries(readFilters(new URLSearchParams('')),{years}).page.sql,args:[]})).rows.map(r=>r.detail).join(' / ')
 assert.match(plan,/USING INDEX _catalog_idx_cards_sigla_lingua_numero/,plan)
 c.close()
})
test('counts are cached and reused across pages and photo filters',async()=>{
 const c=await fixture();let counts=0;const client={execute:async q=>{if(/GROUP BY/.test(q.sql))counts++;return c.execute(q)}}
 for(const p of ['lingua=INT','lingua=INT&pagina=2','lingua=INT&foto=with'])await listCatalog(client,readFilters(new URLSearchParams(p)),{years:new Map()})
 assert.equal(counts,1);c.close()
})

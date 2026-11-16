import {test} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {postgresClient} from './helpers/postgres-client.mjs'
import assert from 'node:assert/strict'
import {enrichCatalog} from '../scripts/enrich-catalog.mjs'
import {cardMetadataEntry,rarityTags,reportedMetadataCards} from '../scripts/card-metadata.mjs'

function database(pages){
 const queries=[]
 return {queries,from(table){
  const q={table,calls:[],then(resolve,reject){return Promise.resolve({data:table==='cards'&&q.calls[0]?.[0]==='select'?(pages.shift()||[]):[],error:null}).then(resolve,reject)}}
  for(const method of ['select','like','not','lte','is','order','limit','update','eq','upsert'])q[method]=(...args)=>{q.calls.push([method,...args]);return q}
  queries.push(q);return q
 }}
}
test('source outage stops the batch rather than retrying every remaining card',async()=>{
 const cards=Array.from({length:20},(_,i)=>({id:i+1,source_uid:`tcgdex:en:${i}`,source_card_id:String(i),source_language:'en'}))
 const db=database([cards])
 const stats=await enrichCatalog({db,onlyUnchecked:true,log:async()=>{},fetchDetail:async()=>{throw Error('TCGdex metadati HTTP 503')}})
 assert.equal(stats.sourceUnavailable,true);assert.ok(stats.attempted<=3);assert.equal(stats.checked,0)
})
test('backfill selects supported sources and unchecked historical cards first',async()=>{
 const db=database([[]]);const stats=await enrichCatalog({db,onlyUnchecked:true,log:async()=>{}})
 assert.equal(db.queries.length,1)
 assert.ok(db.queries[0].calls.some(c=>c[0]==='like'&&c[1]==='source_uid'&&c[2]==='tcgdex:%'))
 assert.ok(db.queries[0].calls.some(c=>c[0]==='is'&&c[1]==='traits_checked_at'&&c[2]===null))
 assert.deepEqual(stats,{attempted:0,checked:0,indexed:0,errors:0})
})
test('source identity mismatch remains pending and never writes tags',async()=>{
 const db=database([[{id:1,nome:'Pikachu',source_uid:'tcgdex:en:base1-58',source_card_id:'base1-58',source_language:'en'}]])
 const stats=await enrichCatalog({db,onlyUnchecked:true,log:async()=>{},fetchDetail:async()=>({id:'wrong'})})
 assert.equal(stats.errors,1);assert.equal(stats.checked,0)
 assert.ok(!db.queries.some(q=>q.table==='catalog_search_entries'))
 assert.ok(db.queries.some(q=>q.calls.some(c=>c[0]==='update'&&c[1].traits_last_error)))
})
test('metadata gives historical cards source variants without assuming normal finish',async()=>{
 const card={id:1,nome:'Pikachu',sigla:'BASE1',lingua:'INT',source_uid:'tcgdex:en:base1-58',source_card_id:'base1-58',source_language:'en'}
 const db=database([[card]])
 const stats=await enrichCatalog({db,onlyUnchecked:true,log:async()=>{},fetchDetail:async()=>({id:'base1-58',localId:'58',variants_detailed:[{type:'reverse',foil:'cosmos'}]})})
 assert.equal(stats.checked,1);assert.equal(stats.indexed,1)
 const entry=db.queries.find(q=>q.table==='catalog_search_entries').calls.find(c=>c[0]==='upsert')[1][0]
 assert.ok(entry.tags.includes('finish:reverse'));assert.ok(entry.tags.includes('pattern:cosmos'))
 assert.ok(!entry.tags.includes('finish:normal'))
})

test('database timeout pauses before another card and preserves the unchecked checkpoint',async()=>{
 const cards=Array.from({length:5},(_,i)=>({id:i+1,nome:'Pikachu',sigla:'BASE1',lingua:'INT',source_uid:`tcgdex:en:${i}`,source_card_id:String(i),source_language:'en'}))
 const base=database([cards]),messages=[]
 const db={from(table){const q=base.from(table);if(table==='catalog_search_entries')q.then=(resolve,reject)=>Promise.resolve({data:null,error:{code:'57014',message:'canceling statement due to statement timeout'}}).then(resolve,reject);return q}}
 const stats=await enrichCatalog({db,concurrency:1,onlyUnchecked:true,log:async m=>messages.push(m),fetchDetail:async c=>({id:c.source_card_id,localId:'1',variants_detailed:[{type:'holo'}]})})
 assert.equal(stats.attempted,1);assert.equal(stats.checked,0);assert.equal(stats.databaseUnavailable,true)
 assert.ok(!base.queries.some(q=>q.table==='cards'&&q.calls.some(c=>c[0]==='update')),'do not retry an error write against an occupied database')
 assert.ok(messages.some(m=>m.includes('Sospendo il lotto')))
})

test('failed error checkpoint pauses instead of rejecting the whole batch',async()=>{
 const card={id:1,source_uid:'tcgdex:en:a',source_card_id:'a',source_language:'en'}
 const base=database([[card]])
 const db={from(table){const q=base.from(table),original=q.then;q.then=(resolve,reject)=>q.calls.some(c=>c[0]==='update')?Promise.resolve({data:null,error:{code:'57014',message:'statement timeout'}}).then(resolve,reject):original.call(q,resolve,reject);return q}}
 const stats=await enrichCatalog({db,concurrency:1,onlyUnchecked:true,log:async()=>{},fetchDetail:async()=>{throw Error('TCGdex metadati HTTP 503')}})
 assert.equal(stats.checked,0);assert.equal(stats.databaseUnavailable,true);assert.equal(stats.sourceUnavailable,true)
})

test('selection timeout defers the batch but permission errors are not swallowed',async()=>{
 const failing=error=>({from(){const q={then:resolve=>resolve({error})};for(const m of ['select','like','not','lte','is','order','limit'])q[m]=()=>q;return q}})
 const stats=await enrichCatalog({db:failing({code:'57014',message:'timeout'}),log:async()=>{}})
 assert.equal(stats.attempted,0);assert.equal(stats.databaseUnavailable,true)
 await assert.rejects(enrichCatalog({db:failing({code:'42501',message:'permission denied'}),log:async()=>{}}),/permission denied/)
})

test('partial persistence replays the same printing keys and only completes after the checkpoint saves',async()=>{
 const card={id:7,nome:'Pikachu',sigla:'BASE1',lingua:'INT',source_uid:'tcgdex:en:a',source_card_id:'a',source_language:'en'}
 const rows=new Map();let failCheckpoint=true,checked=false
 const db={from(table){let mode,payload
 const q={then(resolve){if(mode==='select')return resolve({data:checked?[]:[card],error:null});if(table==='catalog_search_entries')for(const e of payload)rows.set(e.entry_key,e);if(table==='cards'&&mode==='update'){if(failCheckpoint)return resolve({error:{code:'57014',message:'statement timeout'}});checked=true}return resolve({data:[],error:null})}}
 for(const m of ['like','not','lte','is','order','limit','eq'])q[m]=()=>q
 for(const m of ['select','upsert','update'])q[m]=p=>{mode=m;payload=p;return q}
 return q}}
 const options={db,concurrency:1,onlyUnchecked:true,log:async()=>{},fetchDetail:async()=>({id:'a',localId:'1',variants_detailed:[{type:'holo'}]})}
 assert.equal((await enrichCatalog(options)).databaseUnavailable,true);assert.equal(checked,false);assert.equal(rows.size,2)
 failCheckpoint=false
 assert.equal((await enrichCatalog(options)).checked,1);assert.equal(checked,true);assert.equal(rows.size,2)
})

test('completed checkpoints publish progress before the next card can fail',async()=>{
 const cards=[1,2].map(id=>({id,nome:'Pikachu',sigla:'BASE1',lingua:'INT',source_uid:`tcgdex:en:${id}`,source_card_id:String(id),source_language:'en'}))
 const db=database([cards]),progress=[]
 const stats=await enrichCatalog({db,concurrency:1,onlyUnchecked:true,log:async()=>{},onProgress:p=>progress.push(p),fetchDetail:async c=>{if(c.id===2){assert.equal(progress[0].checked,1);throw Error('TCGdex metadati HTTP 503')}return {id:c.source_card_id,variants_detailed:[{type:'holo'}]}}})
 assert.equal(stats.checked,1);assert.equal(stats.errors,1);assert.equal(progress.at(-1).checked,1);assert.equal(progress.at(-1).errors,1)
})

test('card rarity is indexed even without variants, retaining local tags and adding a documented canonical alias',async()=>{
 const card={id:9,nome:'Kissara',sigla:'SV02@IT',lingua:'IT',source_uid:'tcgdex:it:sv02-269',source_card_id:'sv02-269',source_language:'it'}
 const db=database([[card]])
 const stats=await enrichCatalog({db,log:async()=>{},fetchDetail:async()=>({id:'sv02-269',localId:'269',rarity:'Rara illustrazione speciale'})})
 assert.equal(stats.checked,1);assert.equal(stats.indexed,0)
 const g=db.queries.find(q=>q.table==='catalog_search_entries').calls.find(c=>c[0]==='upsert')[1][0]
 assert.equal(g.entry_key,'card:9');assert.equal(g.verification,'catalog')
 assert.ok(g.tags.includes('rarity:special-illustration-rare'));assert.ok(g.tags.includes('rarity:rara-illustrazione-speciale'))
 assert.equal(g.source_payload.variant,undefined);assert.equal(g.source_payload.reference_image_only,true)
 assert.deepEqual(rarityTags(null,'ja'),[],'missing Japanese rarity is never borrowed from an English counterpart')
 assert.ok(!cardMetadataEntry(card,{id:'sv02-269',rarity:'Rara'}).tags.includes('finish:holo'))
 assert.equal(cardMetadataEntry(card,{id:'x',localId:'TG01',rarity:'Rare'}).collector_number,'tg01')
})

test('metadata priority revisits previously checked Italian cards but respects documented and manually protected payloads',async()=>{
 const checked={id:1,source_local_id:'269',traits_checked_at:'2026-11-15T00:00:00Z'}
 const snapshots=[
  [{id:2,source_local_id:'232'},{id:4,source_local_id:'012'}],
  [checked,{id:3,source_local_id:'245'}],
  [{card_id:1,source_payload:{},manual_overrides:{}},
   {card_id:2,source_payload:{rarity:'Special illustration rare'},manual_overrides:{}},
   {card_id:3,source_payload:{},manual_overrides:{source_payload:{}}},
   {card_id:4,source_payload:{},manual_overrides:{}}]
 ]
 const db={from(){const q={then(resolve){return resolve({data:snapshots.shift(),error:null})}};for(const m of ['select','like','order','limit','in','eq'])q[m]=()=>q;return q}}
 const selected=await reportedMetadataCards(db)
 assert.deepEqual(selected.map(c=>c.id),[1,4]);assert.equal(selected[0].traits_checked_at,checked.traits_checked_at)
})

test('mixed printing and generic metadata batches satisfy real PostgreSQL non-null constraints',async()=>{
 const pg=new PGlite();try{
  await pg.exec(`create table cards(id bigint primary key,traits_checked_at timestamptz,traits_next_attempt_at timestamptz,traits_last_error text);
   insert into cards(id)values(9);
   create table catalog_terms(code text primary key,label text,kind text,aliases text[],parents text[]);
   create table catalog_search_entries(entry_key text primary key,card_id bigint not null,collector_number text,denominator text,
    release_year integer,deck_code text,deck_number integer,name text not null,set_code text not null,language text not null,
    tags text[] not null,facts jsonb not null default '{}',source_url text,source_payload jsonb not null,verification text not null,
    label text not null default 'Unknown printing',updated_at timestamptz,search_text text not null default '');`)
  const card={id:9,nome:'Kissara',sigla:'SV02@IT',lingua:'IT',source_card_id:'sv02-269',source_uid:'tcgdex:it:sv02-269',source_language:'it'}
  const stats=await enrichCatalog({db:postgresClient(pg),cardRows:[card],log:async()=>{},fetchDetail:async()=>({id:'sv02-269',localId:'269',rarity:'Rara illustrazione speciale',variants_detailed:[{type:'normal'}]})})
  assert.equal(stats.checked,1)
  const entries=(await pg.query('select * from catalog_search_entries order by entry_key')).rows
  assert.equal(entries.length,2);assert.equal(entries[0].entry_key,'card:9')
  assert.equal(entries[0].facts.asian_script,false);assert.equal(entries[0].source_payload.variant,undefined)
  assert.ok(entries[0].tags.includes('rarity:special-illustration-rare'))
  assert.ok(entries.every(e=>e.label&&e.search_text))
 }finally{await pg.close()}
})

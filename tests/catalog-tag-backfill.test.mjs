import {test} from 'node:test'
import assert from 'node:assert/strict'
import {enrichCatalog} from '../scripts/enrich-catalog.mjs'

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

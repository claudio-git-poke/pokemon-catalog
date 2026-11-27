import {test} from 'node:test'
import assert from 'node:assert/strict'
import {catalogFixture,rowFor,schema} from './helpers/turso-fixture.mjs'
import {stageWorkerDelta,publishWorkerDelta} from '../scripts/turso-worker-publish.mjs'
import {canonicalJson,hash} from '../scripts/turso-snapshot.mjs'
const N=20
async function setup(){
 const cards=Array.from({length:N},(_,i)=>({id:i+1,nome:'C'+i,sigla:'S',lingua:'IT',file_name:'f'+i}))
 const entries=Array.from({length:N},(_,i)=>({entry_key:'e'+i,card_id:i+1,name:'C'+i,set_code:'S',language:'IT',verification:'source',search_text:'vecchio'+i,tags:['a:1','b:2']}))
 const c=await catalogFixture({cards,catalog_search_entries:entries,catalog_live_updates:[{scope:'catalog',revision:1,updated_at:'2026-11-17T00:00:00+00:00'}]})
 let run=100
 const total=async()=>Number((await c.execute('SELECT total_changes() n')).rows[0].n)
 const current=async(t,k)=>JSON.parse((await c.execute({sql:'SELECT _row FROM "_copy_'+t+'" WHERE _key=?',args:[canonicalJson(k)]})).rows[0]._row)
 const revision=async()=>Number((await c.execute("SELECT json_extract(_row,'$.revision') r FROM _copy_catalog_live_updates")).rows[0].r)
 async function publish(changes){
  const id=String(run++)
  await stageWorkerDelta(c,schema,{contract:'catalog-worker-delta-v1',run_id:id,source_id:'domain-fixture',changes})
  const before=await total();await publishWorkerDelta(c,schema,id,{batchSize:100})
  return ((await total())-before)/changes.length
 }
 const update=async(table,keys,patch)=>Promise.all(keys.map(async k=>{const r=await current(table,k);return {table_name:table,record_key:k,first_old:r,last_new:{...r,...patch(r)}}}))
 return {c,entries,cards,publish,update,current,revision}
}
const fts=async(c,word)=>Number((await c.execute({sql:'SELECT count(*) n FROM _catalog_entry_fts WHERE _catalog_entry_fts MATCH ?',args:[word]})).rows[0].n)
const tag=async(c,value)=>Number((await c.execute({sql:'SELECT count(*) n FROM _catalog_entry_tags WHERE tag=?',args:[value]})).rows[0].n)
test('worker publications skip writes that change nothing and keep search and tags exact',async()=>{
 const {c,entries,cards,publish,update,revision}=await setup()
 const keys=entries.map(e=>[e.entry_key])
 const start=await revision()
 const cheap=await publish(await update('catalog_search_entries',keys,()=>({label:'etichetta'})))
 assert.ok(cheap<5,'stampa aggiornata con testo e tag invariati: '+cheap)
 assert.equal(await revision(),start+1,'una sola revisione per lotto pubblicato')
 assert.equal(await fts(c,'vecchio0'),1);assert.equal(await tag(c,'a:1'),N)
 const textCost=await publish(await update('catalog_search_entries',keys,r=>({search_text:r.search_text.replace('vecchio','nuovo')})))
 assert.ok(textCost<10,'solo il testo cambia: '+textCost)
 assert.equal(await fts(c,'vecchio0'),0,'il testo vecchio esce dalla ricerca');assert.equal(await fts(c,'nuovo0'),1)
 assert.equal(await tag(c,'a:1'),N,'i tag invariati restano')
 const tagCost=await publish(await update('catalog_search_entries',keys,r=>({tags:[...r.tags.filter(t=>t!=='b:2'),'z:9']})))
 assert.ok(tagCost<25,'tag cambiati: '+tagCost)
 assert.equal(await tag(c,'b:2'),0);assert.equal(await tag(c,'z:9'),N);assert.equal(await tag(c,'a:1'),N)
 const cardCost=await publish(await update('cards',cards.map(x=>[x.id]),()=>({image_status:'found',image_url:'https://img'})))
 assert.ok(cardCost<5,'carta aggiornata: '+cardCost)
 const fresh=await publish(Array.from({length:N},(_,i)=>({table_name:'catalog_search_entries',record_key:['n'+i],first_old:null,last_new:rowFor('catalog_search_entries',{entry_key:'n'+i,card_id:i+1,name:'N'+i,set_code:'S',language:'IT',verification:'source',search_text:'fresca'+i,tags:['k:1']})})))
 assert.ok(fresh<16,'stampa nuova: '+fresh)
 assert.equal(await fts(c,'fresca3'),1);assert.equal(await tag(c,'k:1'),N)
 assert.equal(await revision(),start+5)
 // Stored digests always describe the stored rows.
 for(const r of (await c.execute('SELECT _row,_hash FROM _copy_catalog_search_entries')).rows)assert.equal(r._hash,hash(canonicalJson(JSON.parse(r._row))))
 c.close()
})
test('manual edits on Turso still bump the revision on every row and keep their locks against the worker',async()=>{
 const {c,publish,update,current,revision}=await setup()
 const before=await revision()
 await c.execute("UPDATE cards SET nome='Scelta a mano' WHERE id=1")
 const card=await current('cards',[1])
 assert.equal(card.nome,'Scelta a mano');assert.equal(card.manual_overrides.nome,'Scelta a mano')
 assert.ok(await revision()>before,'le modifiche manuali aggiornano subito il catalogo')
 await publish([{table_name:'cards',record_key:[1],first_old:card,last_new:{...card,nome:'Nome dalla fonte',image_status:'found'}}])
 const after=await current('cards',[1])
 assert.equal(after.nome,'Scelta a mano','la correzione manuale resta');assert.equal(after.image_status,'found','il resto della pubblicazione passa')
 c.close()
})
test('an existing database moves from guard version 2 to the current one and keeps every guard',async()=>{
 const {installManualGuards,GUARD_VERSION}=await import('../src/server/turso-manual.mjs')
 const {c,cards,publish,update,current}=await setup()
 const triggers=async()=>(await c.execute("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name")).rows.map(r=>r.name)
 const names=await triggers()
 await c.execute('UPDATE _catalog_guard_version SET version=2 WHERE id=1')
 await installManualGuards(c,schema)
 assert.equal(Number((await c.execute('SELECT version FROM _catalog_guard_version WHERE id=1')).rows[0].version),GUARD_VERSION)
 assert.deepEqual(await triggers(),names,'stesse protezioni dopo l’aggiornamento')
 assert.ok((await publish(await update('cards',cards.map(x=>[x.id]),()=>({image_status:'found'}))))<5)
 assert.equal((await current('cards',[1])).image_status,'found')
 c.close()
})
test('the manual history never scans its table on a write, and numbers new entries after the highest id',async()=>{
 const {HISTORY_SEED}=await import('../src/server/turso-manual.mjs')
 const {c,cards,publish,update}=await setup()
 const plan=(await c.execute('EXPLAIN QUERY PLAN '+HISTORY_SEED)).rows.map(r=>r.detail).join(' / ')
 assert.doesNotMatch(plan,/SCAN _copy_catalog_manual_history/,plan)
 // Every guard trigger must use the indexed seed, not a full scan of the history.
 for(const {sql} of (await c.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND sql LIKE '%_copy_catalog_manual_history%'")).rows)
  assert.doesNotMatch(sql,/max\(json_extract\(_row,'\$\.id'\)\),0\)\+1 id,coalesce\(max\(_position\),0\)\+1 position FROM _copy_catalog_manual_history WHERE/)
 // A history copied out of order: the highest id is not on the last position.
 await c.execute({sql:'INSERT INTO _copy_catalog_manual_history(_key,_row,_hash,_position) VALUES(?,?,?,?)',args:['[500]',JSON.stringify({id:500,table_name:'cards',record_key:{id:1}}),'x',-1]})
 assert.ok((await publish(await update('cards',cards.map(x=>[x.id]),()=>({image_status:'found'}))))<5,'automatic publications stay cheap')
 await c.execute("UPDATE cards SET nome='A mano' WHERE id=2")
 const ids=(await c.execute("SELECT json_extract(_row,'$.id') id FROM _copy_catalog_manual_history ORDER BY _position DESC LIMIT 1")).rows
 assert.equal(Number(ids[0].id),501)
 c.close()
})

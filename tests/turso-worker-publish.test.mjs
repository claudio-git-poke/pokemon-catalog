import {test} from 'node:test'
import assert from 'node:assert/strict'
import {catalogFixture,rowFor,schema} from './helpers/turso-fixture.mjs'
import {canonicalJson} from '../scripts/turso-snapshot.mjs'
import {stageWorkerDelta,publishWorkerDelta} from '../scripts/turso-worker-publish.mjs'
const read=async(c,name,key)=>{const r=(await c.execute({sql:'SELECT _row FROM "_copy_'+name+'" WHERE _key=?',args:[canonicalJson(key)]})).rows[0];return r?JSON.parse(r._row):null}

test('durable publication resumes after interruption, preserves a later manual edit and timestamps feeds at publication',async()=>{
 const c=await catalogFixture({cards:[{id:1,nome:'Iono',notes:'Memo',sigla:'SV02@IT',lingua:'IT'}]})
 await c.execute('UPDATE cards SET notes=NULL WHERE id=1')
 const before=await read(c,'cards',[1]),after={...before,notes:'automatic',image_status:'found',image_url:'https://example.test/new.png',updated_at:'2020-01-01T00:00:00Z'}
 const printing=rowFor('catalog_search_entries',{entry_key:'tcgdex:1:normal',card_id:1,name:'Nome della fonte',set_code:'SV02@IT',language:'IT',verification:'source',search_text:'nome fonte',tags:['rarity:rare']})
 const canonical=rowFor('set_carte',{sigla:'SV02',numero:269,variante:'normal',nome:'Iono',aggiornato_il:'2020-01-01T00:00:00Z'})
 const packet={contract:'catalog-worker-delta-v1',run_id:'100',source_id:'domain-fixture',manual_versions:[{table_name:'cards',record_key:'[1]',version:1}],changes:[
  {table_name:'set_carte',record_key:['SV02',269,'normal'],first_old:null,last_new:canonical},
  {table_name:'catalog_search_entries',record_key:['tcgdex:1:normal'],first_old:null,last_new:printing},
  {table_name:'cards',record_key:[1],first_old:before,last_new:after}
 ]}
 await stageWorkerDelta(c,schema,packet,{chunkSize:128})
 assert.equal((await c.execute('SELECT state FROM _catalog_worker_journal')).rows[0].state,'ready')
 const clock=()=>Date.parse('2030-01-01T00:00:00Z')
 const partial=await publishWorkerDelta(c,schema,'100',{maxBatches:1,batchSize:1,clock});assert.equal(partial.complete,false);assert.equal(partial.rows,1)
 await c.execute("UPDATE cards SET nome='Scelta manuale successiva' WHERE id=1")
 const version=Number((await c.execute('SELECT version FROM _catalog_manual_outbox WHERE table_name=\'cards\'')).rows[0].version)
 const result=await publishWorkerDelta(c,schema,'100',{batchSize:1,clock});assert.equal(result.complete,true)
 const card=await read(c,'cards',[1]);assert.equal(card.nome,'Scelta manuale successiva');assert.equal(card.notes,null);assert.equal(card.image_url,'https://example.test/new.png')
 const entry=await read(c,'catalog_search_entries',['tcgdex:1:normal']);assert.equal(entry.name,'Scelta manuale successiva');assert.equal(entry.updated_at,'2030-01-01T00:00:00.000Z')
 assert.equal((await read(c,'set_carte',['SV02',269,'normal'])).aggiornato_il,'2030-01-01T00:00:00.000Z')
 assert.equal(Number((await c.execute('SELECT version FROM _catalog_manual_outbox WHERE table_name=\'cards\'')).rows[0].version),version)
 assert.equal((await c.execute('SELECT count(*) n FROM _catalog_worker_chunks')).rows[0].n,0)
 assert.equal((await c.execute('SELECT data_key FROM _catalog_worker_journal')).rows[0].data_key,null)
 assert.equal((await publishWorkerDelta(c,schema,'100')).already_applied,true)
 const stored=(await c.execute("SELECT _row,_hash FROM _copy_cards WHERE _key='[1]'")).rows[0];assert.equal(stored._hash,'pending','later direct SQL edit marks its digest pending')
 assert.equal((await c.execute("SELECT count(*) n FROM _catalog_entry_fts WHERE _catalog_entry_fts MATCH 'successiva'")).rows[0].n,1)
 c.close()
})
test('a conflicting new identity rolls back data and cursor; authenticated archives remain available for retry',async()=>{
 const c=await catalogFixture({cards:[{id:1,nome:'Originale'}]}),existing=await read(c,'cards',[1])
 const packet={contract:'catalog-worker-delta-v1',run_id:'101',source_id:'domain-fixture',changes:[{table_name:'cards',record_key:[1],first_old:null,last_new:{...existing,nome:'Altra identità'}}]}
 await stageWorkerDelta(c,schema,packet)
 await assert.rejects(publishWorkerDelta(c,schema,'101'),/identità già occupata/)
 assert.equal((await read(c,'cards',[1])).nome,'Originale');assert.equal(Number((await c.execute('SELECT cursor FROM _catalog_worker_journal')).rows[0].cursor),0)
 assert.equal((await c.execute('SELECT mode FROM _catalog_write_context')).rows[0].mode,'manual')
 await assert.rejects(stageWorkerDelta(c,schema,{...packet,run_id:'102'}),/precedente/)
 c.close()
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sealWorkerDelta,openWorkerDelta,mergeWorkerChange} from '../scripts/turso-worker-data.mjs'
import {hash} from '../scripts/turso-snapshot.mjs'
test('encrypted worker archives retain every typed manual value and reject tampering or the wrong key',()=>{
 const packet={contract:'catalog-worker-delta-v1',changes:[{table:'cards',key:[1],before:null,after:{nome:'エネルギー',notes:null,manual_overrides:{notes:null,tags:[],facts:{}}}}]}
 const sealed=sealWorkerDelta(packet)
 assert.ok(!sealed.bytes.includes(Buffer.from('エネルギー')));assert.deepEqual(openWorkerDelta(sealed.bytes,sealed.key,sealed.digest),packet)
 const corrupt=Buffer.from(sealed.bytes);corrupt[40]^=1
 assert.throws(()=>openWorkerDelta(corrupt,sealed.key,sealed.digest),/non valido/)
 assert.throws(()=>openWorkerDelta(corrupt,sealed.key,hash(corrupt)),/non autenticato/)
 assert.throws(()=>openWorkerDelta(sealed.bytes,Buffer.alloc(32),sealed.digest),/non autenticato/)
})
test('three-way publication preserves concurrent manual changes, explicit empty locks and deleted records',()=>{
 const before={id:1,nome:'Fonte',notes:'Memo',tags:['rare'],manual_overrides:{}},after={...before,nome:'Fonte aggiornata',notes:'Nuova nota',tags:['ultra']},current={...before,nome:'Scelta umana',notes:null,tags:[],manual_overrides:{nome:'Scelta umana',notes:null,tags:[]}}
 const result=mergeWorkerChange(before,{...after,image_url:'new'},current)
 assert.equal(result.operation,'write');assert.equal(result.row.nome,'Scelta umana');assert.equal(result.row.notes,null);assert.deepEqual(result.row.tags,[]);assert.equal(result.row.image_url,'new')
 assert.deepEqual(mergeWorkerChange(before,null,current),{operation:'keep'})
 assert.deepEqual(mergeWorkerChange(before,after,null),{operation:'keep'})
 assert.deepEqual(mergeWorkerChange(null,after,current),{operation:'conflict'})
 assert.deepEqual(mergeWorkerChange(before,null,before),{operation:'delete'})
})

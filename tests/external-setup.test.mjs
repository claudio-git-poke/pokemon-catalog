import {test} from 'node:test'
import assert from 'node:assert/strict'
import {externalImages} from '../src/lib/external-cards.ts'
const card={sigla:'base1',lingua:'INT',numero:1}
const failing=code=>({from(){const q={select(){return q},eq(){return q},limit(){return Promise.resolve({data:null,error:{code,message:'Test setup failure'}})}};return q}})
test('manual search can run before optional index setup, worker remains strict',async()=>{
 assert.deepEqual(await externalImages(failing('PGRST205'),card,{allowUnconfigured:true}),[])
 await assert.rejects(externalImages(failing('PGRST205'),card),/Indice fonti/)
})
test('optional setup handling does not hide database permission errors',async()=>{
 await assert.rejects(externalImages(failing('42501'),card,{allowUnconfigured:true}),/Indice fonti/)
})

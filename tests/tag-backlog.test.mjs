import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readTagBacklog} from '../scripts/tag-backlog.mjs'
function db(result){const q={select(){return q},like(){return q},is(){return q},then(resolve,reject){return (result instanceof Error?Promise.reject(result):Promise.resolve(result)).then(resolve,reject)}};return {from:()=>q}}
test('backlog count is a timestamped informational snapshot, including a real zero',async()=>{
 assert.deepEqual(await readTagBacklog({db:db({count:0,error:null}),clock:()=>0}),{count:0,at:'1970-01-01T00:00:00.000Z',error:null})
})
test('failed or missing counts remain unknown and never abort processing',async()=>{
 for(const response of [{count:null,error:{message:'statement timeout'}},{count:null,error:{}},{count:null,error:null},new Error('fetch failed')]){
  const result=await readTagBacklog({db:db(response)})
  assert.equal(result.count,null);assert.equal(result.at,null);assert.ok(result.error)
 }
})

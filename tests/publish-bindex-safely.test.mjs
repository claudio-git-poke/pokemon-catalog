import {test} from 'node:test'
import assert from 'node:assert/strict'
import {publishBindexSafely} from '../scripts/publish-bindex-safely.mjs'
test('publication timeout is recorded and does not stop the import session',async()=>{
 let saved;const db={from(table){assert.equal(table,'catalog_sync_runs');return {async insert(row){saved=row;return {error:null}}}}}
 const result=await publishBindexSafely({db,publish:async()=>{throw Error('canceling statement due to statement timeout')},log:()=>{}})
 assert.equal(result.errors,1);assert.equal(saved.status,'partial');assert.equal(saved.summary.task,'bindex-publish');assert.match(saved.summary.error,/timeout/)
})
test('successful publication keeps its result without writing an error run',async()=>{
 const result=await publishBindexSafely({db:{from(){throw Error('unexpected error record')}},publish:async()=>({published:12,pending:2})})
 assert.deepEqual(result,{published:12,pending:2,errors:0})
})

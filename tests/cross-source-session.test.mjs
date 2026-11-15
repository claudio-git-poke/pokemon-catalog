import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runCrossSourceSession} from '../scripts/cross-source-session.mjs'
function fixture(n){let selected=0;return {get selected(){return selected},db:{async rpc(name,args){assert.equal(name,'catalog_cross_source_due');assert.equal(args.batch_size,1);return {data:selected++<n?[{source_language:'ja',primary_set:'set-'+selected}]:[],error:null}}}}}
const ok=async()=>({status:'concordant',reason:'Same numbers and names'})
test('comparison session works independently, stops at its cap and publishes saved progress',async()=>{
 const f=fixture(9),progress=[]
 const stats=await runCrossSourceSession({db:f.db,limit:2,log:()=>{},onProgress:s=>progress.push(s),comparePair:ok})
 assert.equal(stats.checked,2);assert.equal(stats.concordant,2);assert.equal(stats.stop_reason,'limit');assert.equal(f.selected,2);assert.equal(progress[0].checked,1)
})
test('empty or exhausted comparison queue exits without waiting for import work',async()=>{
 const f=fixture(0);const stats=await runCrossSourceSession({db:f.db,log:()=>{},comparePair:ok})
 assert.equal(stats.checked,0);assert.equal(stats.stop_reason,'exhausted')
})
test('comparison session reserves time for saving and ends on a source rate limit',async()=>{
 let time=0;const f=fixture(9)
 const stats=await runCrossSourceSession({db:f.db,budgetMs:40000,clock:()=>time,log:()=>{},comparePair:async()=>{time+=25000;return ok()}})
 assert.equal(stats.checked,1);assert.equal(stats.stop_reason,'budget');assert.equal(f.selected,1)
 const g=fixture(9);const unavailable=await runCrossSourceSession({db:g.db,log:()=>{},comparePair:async()=>({status:'error',reason:'Error: TCGdex HTTP 429'})})
 assert.equal(unavailable.errors,1);assert.equal(unavailable.checked,1);assert.equal(unavailable.stop_reason,'source_unavailable');assert.equal(g.selected,1)
})
test('failed evidence persistence is not counted as a successful comparison',async()=>{
 const f=fixture(1),progress=[]
 await assert.rejects(runCrossSourceSession({db:f.db,log:()=>{},onProgress:s=>progress.push(s),comparePair:async()=>{throw Error('evidence write failed')}}),/evidence write failed/)
 assert.equal(progress.length,0)
})

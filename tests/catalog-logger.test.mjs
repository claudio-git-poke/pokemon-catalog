import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCatalogLogger} from '../scripts/catalog-logger.mjs'
test('events go only to the process output; the database receives throttled summaries',async()=>{
 const tables=[],summaries=[],lines=[]
 let clock=Date.parse('2026-01-01T00:00:00Z')
 const db={from(table){tables.push(table);return {
  async upsert(){throw Error('Il registro non deve scrivere eventi nel database.')},
  update(row){return {async eq(column,value){assert.equal(column,'id');assert.equal(value,7);summaries.push(row.summary.current);return {error:null}}}}
 }}}
 const log=createCatalogLogger({db,runId:7,summary:{added:3},clock:()=>clock,output:line=>lines.push(line)})
 for(let i=0;i<2100;i++){await log(`Carta ${i}`);clock+=100}
 await log('Fine',true)
 assert.equal(lines.length,2101)
 assert.ok(tables.every(t=>t==='catalog_sync_runs'))
 assert.ok(summaries.length<=10,'one summary at most every 30 seconds, plus forced ones')
 assert.equal(summaries.at(-1),'Fine')
})
test('concurrent forced writes keep only the latest summary',async()=>{
 const summaries=[]
 const db={from(){return {update(row){return {async eq(){await new Promise(r=>setTimeout(r,5));summaries.push(row.summary.current);return {error:null}}}}}}}
 const log=createCatalogLogger({db,runId:1,summary:{},output:()=>{}})
 await Promise.all(Array.from({length:90},(_,i)=>log(`Carta ${i}`,true)))
 assert.equal(summaries.at(-1),'Carta 89')
 assert.ok(summaries.length<90,'superseded snapshots are not written')
})
test('logger replays a failed summary once and recovers on the next write',async()=>{
 const summaries=[],waits=[];let failures=2
 const db={from(){return {update(row){return {async eq(){if(failures-->0)return {error:{code:'57014',message:'statement timeout'}};summaries.push(row.summary.current);return {error:null}}}}}}}
 const log=createCatalogLogger({db,runId:1,summary:{},output:()=>{},wait:async ms=>waits.push(ms)})
 await assert.rejects(log('Prima carta',true),/statement timeout/)
 await log('Seconda carta',true)
 assert.deepEqual(summaries,['Seconda carta'])
 assert.deepEqual(waits,[1500],'a flush only retries once before reporting failure')
})

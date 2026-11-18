import {test} from 'node:test'
import assert from 'node:assert/strict'
import {planBudget,readTursoUsage,estimateWrites,FREE_LIMITS} from '../scripts/turso-budget.mjs'
import {catalogFixture,rowFor,schema} from './helpers/turso-fixture.mjs'
import {stageWorkerDelta,publishWorkerDelta} from '../scripts/turso-worker-publish.mjs'
const now=Date.parse('2026-12-11T00:00:00Z')
const usage=(w,r=0,s=0)=>({rows_written:w,rows_read:r,storage_bytes:s})
test('budget spreads the remaining safe quota over the rest of the month',()=>{
 const plan=planBudget(usage(0),{now})
 assert.equal(plan.allowed,true);assert.equal(plan.days_left,21)
 assert.equal(plan.writes,Math.min(400000,Math.floor(8_000_000/42)))
})
test('budget stops before the free limit and when the month is spent',()=>{
 assert.equal(planBudget(usage(8_000_000),{now}).allowed,false)
 assert.equal(planBudget(usage(0,400_000_000),{now}).allowed,false)
 assert.equal(planBudget(usage(0,0,FREE_LIMITS.storage_bytes),{now}).allowed,false)
 const tight=planBudget(usage(7_990_000),{now:Date.parse('2026-12-01T00:00:00Z')})
 assert.equal(tight.allowed,false,'a residual too small for one batch skips the run')
})
test('usage is read from the Platform API and fails closed without credentials',async()=>{
 await assert.rejects(readTursoUsage({token:'',organization:'x'}),/TURSO_API_TOKEN/)
 const fetchImpl=async(url,init)=>{assert.equal(url,'https://api.turso.tech/v1/organizations/demo/usage');assert.equal(init.headers.authorization,'Bearer t');return {ok:true,async json(){return {organization:{usage:{rows_read:5,rows_written:7,storage_bytes:9}}}}}}
 assert.deepEqual(await readTursoUsage({token:'t',organization:'demo',fetchImpl}),usage(7,5,9))
 await assert.rejects(readTursoUsage({token:'t',organization:'demo',fetchImpl:async()=>({ok:false,status:403})}),/HTTP 403/)
})
test('publication stops at the write budget and resumes from the saved cursor',async()=>{
 const cards=Array.from({length:6},(_,i)=>({id:i+1,nome:'C'+i,sigla:'S',lingua:'IT'}))
 const c=await catalogFixture({cards})
 const changes=cards.map(card=>{const row=rowFor('cards',card);return {table_name:'cards',record_key:[card.id],first_old:row,last_new:{...row,image_status:'found'}}})
 await stageWorkerDelta(c,schema,{contract:'catalog-worker-delta-v1',run_id:'7',source_id:'domain-fixture',changes})
 const first=await publishWorkerDelta(c,schema,'7',{batchSize:2,writeBudget:estimateWrites('cards',4)})
 assert.equal(first.budget_reached,true);assert.equal(first.rows,4);assert.equal(first.complete,false)
 const second=await publishWorkerDelta(c,schema,'7',{batchSize:2})
 assert.equal(second.complete,true);assert.equal(second.rows,6)
})
test('front-loaded spending finishes the month quota by the chosen date, then falls back',()=>{
 const now=Date.parse('2026-11-18T14:00:00Z'),spendBy=Date.parse('2026-11-25T00:00:00Z')
 const even=planBudget(usage(1_700_000),{now,stopRatio:0.9,maxRunWrites:900_000})
 const fast=planBudget(usage(1_700_000),{now,stopRatio:0.9,maxRunWrites:900_000,spendBy})
 assert.equal(even.spend_days,13);assert.equal(fast.spend_days,7)
 assert.ok(fast.writes>1.8*even.writes,'circa il doppio per esecuzione')
 assert.equal(fast.writes,Math.floor((9_000_000-1_700_000)/14))
 const after=planBudget(usage(8_000_000),{now:Date.parse('2026-11-26T00:00:00Z'),stopRatio:0.9,maxRunWrites:900_000,spendBy})
 assert.equal(after.spend_days,1);assert.equal(after.writes,500_000,'dopo la data resta disponibile il residuo, entro il tetto')
 assert.throws(()=>planBudget(usage(0),{now,maxRunWrites:5_000_000}),/Tetto/)
})
test('write budget is proportional to the time since the previous run, so skipped runs are recovered',()=>{
 const now=Date.parse('2026-11-18T18:41:00Z'),spendBy=Date.parse('2026-11-25T00:00:00Z'),options={now,stopRatio:0.9,maxRunWrites:900_000,spendBy,runsPerDay:8}
 const remaining=9_000_000-2_000_000
 const regular=planBudget(usage(2_000_000),{...options,previousRunAt:now-3*3600000})
 const skipped=planBudget(usage(2_000_000),{...options,previousRunAt:now-9*3600000})
 const share=h=>h*3600000/(spendBy-(now-h*3600000))
 assert.equal(regular.writes,Math.floor(remaining*share(3)))
 assert.equal(skipped.writes,Math.floor(remaining*share(9)),'tre turni saltati: il successivo recupera')
 assert.ok(skipped.writes>2.5*regular.writes)
 const late=planBudget(usage(8_500_000),{...options,now:Date.parse('2026-11-26T00:00:00Z'),previousRunAt:Date.parse('2026-11-25T21:00:00Z')})
 assert.equal(late.share,1);assert.equal(late.writes,500_000,'dopo la data, il residuo resta disponibile')
 const unknown=planBudget(usage(2_000_000),{...options,previousRunAt:null})
 assert.equal(unknown.writes,Math.floor(remaining/(7*8)),'senza dati sul turno precedente: quota divisa per esecuzione')
})

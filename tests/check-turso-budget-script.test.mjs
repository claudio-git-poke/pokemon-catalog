import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
// Runs the real budget script with a fake usage report: it must plan a run,
// never fail on a programming error (for example a helper lost in a refactor).
const fakeFetch='data:text/javascript,'+encodeURIComponent('globalThis.fetch=async()=>new Response(JSON.stringify({organization:{usage:{rows_written:1000,rows_read:1000,storage_bytes:1000}}}))')
test('budget script plans a run from a usage report', async()=>{
 const {stdout}=await promisify(execFile)(process.execPath,['--import',fakeFetch,'scripts/check-turso-budget.mjs'],{env:{PATH:process.env.PATH,TURSO_API_TOKEN:'fake',TURSO_ORGANIZATION:'fake-org',TURSO_RUNS_PER_DAY:'48',TURSO_ESTIMATE_RATIO:'0.7'}})
 const plan=JSON.parse(stdout.split('\n').find(line=>line.includes('"turso-budget"')))
 assert.equal(plan.allowed,true,plan.reason)
 assert.ok(plan.writes>0)
})

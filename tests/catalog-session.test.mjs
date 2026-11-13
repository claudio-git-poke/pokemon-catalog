import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runSession, sessionMinutes } from '../scripts/catalog-session.mjs'

test('session continues after partial cycles and stops when queues are empty', async () => {
  let time = 0, calls = 0, pauses = 0
  const cycles = await runSession({ minutes: 330, clock: () => time, log: () => {},
    runCycle: async () => { calls++; time += 480000; return {added:1,found:0,errors:1} },
    hasWork: async () => calls < 3, pause: async () => { pauses++; time += 5000 } })
  assert.equal(cycles,3); assert.equal(pauses,3)
})
test('session stops before the job deadline and fatal errors propagate', async () => {
  let time = 0
  assert.equal(await runSession({minutes:8,clock:()=>time,log:()=>{},hasWork:async()=>true,
    runCycle:async()=>{time+=480000;return {added:0,found:0,errors:0}}}),1)
  await assert.rejects(runSession({minutes:8,log:()=>{},runCycle:async()=>{throw Error('database unavailable')}}),/database unavailable/)
  assert.throws(()=>sessionMinutes('331'))
  assert.throws(()=>sessionMinutes('invalid'))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {nextQuietState} from '../scripts/local-copy-stats.mjs'
test('the local chain stops after two quiet group A runs', ()=>{
 let s={runs:1,last_group:'A',start:{cards:100,photos:50}}
 let r=nextQuietState(s,{cards:500,photos:90});assert.equal(r.stop,false);assert.equal(r.state.quiet_a,0)
 r=nextQuietState({...r.state,runs:2,last_group:'B',start:{cards:500,photos:90}},{cards:500,photos:90});assert.equal(r.state.quiet_a,0)
 r=nextQuietState({...r.state,runs:3,last_group:'A',start:{cards:500,photos:90}},{cards:503,photos:95});assert.equal(r.state.quiet_a,1);assert.equal(r.stop,false)
 r=nextQuietState({...r.state,runs:4,last_group:'B',start:{cards:503,photos:95}},{cards:503,photos:95});assert.equal(r.state.quiet_a,1)
 r=nextQuietState({...r.state,runs:5,last_group:'A',start:{cards:503,photos:95}},{cards:503,photos:96});assert.equal(r.stop,true)
 assert.equal(r.state.history.length,5)
})
test('a busy group A run resets the quiet count', ()=>{
 const r=nextQuietState({runs:3,last_group:'A',quiet_a:1,start:{cards:0,photos:0}},{cards:0,photos:40})
 assert.equal(r.state.quiet_a,0);assert.equal(r.stop,false)
})

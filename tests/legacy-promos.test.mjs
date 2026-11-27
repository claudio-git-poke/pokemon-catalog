import {test} from 'node:test'
import assert from 'node:assert/strict'
import {planLegacyPromos} from '../scripts/legacy-promos.mjs'
test('a legacy promo joins the official card only when one nearby card is the same Pokémon',()=>{
 const cards=[
  {id:1,sigla:'SMP@JP',numero:7,nome:'クワガノン',source_uid:'atlas:ja:SMP-1'},
  {id:2,sigla:'SMP@JP',numero:9,nome:'ピカチュウ',source_uid:'atlas:ja:SMP-2'},
  {id:3,sigla:'SMP@JP',numero:12,nome:'ピカチュウ',source_uid:'atlas:ja:SMP-3'},
  {id:10,sigla:'SM-P@JP',numero:8,nome:'Vikavolt',source_uid:null},
  {id:11,sigla:'SM-P@JP',numero:10,nome:'Pikachu',source_uid:null},
  {id:12,sigla:'SM-P@JP',numero:40,nome:'Ultra Ball',source_uid:null},
  {id:13,sigla:'SM-P@JP',numero:8,nome:'Vikavolt',source_uid:null,manual_overrides:{nome:'x'}}]
 const {merges,flags}=planLegacyPromos(cards)
 assert.deepEqual(merges.map(m=>[m.dup.id,m.keep.id]),[[10,1]])
 assert.deepEqual(flags.map(c=>c.id),[11,12],'two Pikachu nearby: ambiguous; trainers: flagged')
})

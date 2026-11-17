import {test} from 'node:test'
import assert from 'node:assert/strict'
import {rarityTags,knownRarity} from '../scripts/card-metadata.mjs'
import {normalizeSearch} from '../src/lib/catalog-identification.ts'
import {rarityEvidence,unambiguousEvidence,collectRarityEvidence} from '../scripts/rarity-evidence.mjs'
test('Latin accents normalize while Japanese dakuten stay composed',()=>{
 assert.equal(normalizeSearch('Énergie — エネルギー ポケモン'),'energie エネルギー ポケモン')
 assert.equal(normalizeSearch('エネルギー'.normalize('NFD')),'エネルギー')
})
test('native rarity codes retain their literal tag and documented canonical equivalent',()=>{
 assert.deepEqual(rarityTags('rare_sar','ja'),['rarity:rare-sar','rarity:sar','rarity:special-illustration-rare'])
 assert.ok(rarityTags('rare_sr_c','ja').includes('rarity:ultra-rare'))
 assert.ok(rarityTags('SSR','ko').includes('rarity:shiny-ultra-rare'))
 assert.deepEqual(rarityTags('rare_hr','ja'),['rarity:rare-hr','rarity:hr'])
 assert.deepEqual(rarityTags('unknown','ja'),['rarity:unknown'])
 assert.deepEqual(rarityTags('---','ja'),[])
 assert.equal(knownRarity('rare_c2','ja'),false)
})
test('rarity membership is exact in its requested language, rejects mismatches and quarantines conflicting IDs',async()=>{
 const body={name:'Selten, besondere Illustration',cards:[{id:'sv02-269'},{id:'sv03-223'}]}
 const rows=rarityEvidence('de',body.name,body,'https://api.tcgdex.net/v2/de/rarities/test')
 assert.equal(rows[0].source_uid,'tcgdex:de:sv02-269')
 assert.throws(()=>rarityEvidence('fr','Rare',body,''),/coerente/)
 assert.throws(()=>rarityEvidence('de',body.name,{...body,cards:[body.cards[0],body.cards[0]]},''),/duplicate/)
 const conflicts=unambiguousEvidence([...rows,{...rows[0],rarity:'Häufig'}])
 assert.deepEqual(conflicts.conflicts,['tcgdex:de:sv02-269']);assert.equal(conflicts.rows.length,1)
 const fetched=[]
 const evidence=await collectRarityEvidence({language:'de',fetchJson:async url=>{fetched.push(url);return url.endsWith('/rarities')?[body.name,'Unknown special label']:body}})
 assert.equal(evidence.rows.length,2);assert.equal(fetched.length,2)
 assert.equal(evidence.errors.length,0)
 assert.equal(evidence.rows[0].source_language,'de')
 assert.equal(evidence.rows[0].image_url,undefined)
})

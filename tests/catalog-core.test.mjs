import { test } from 'node:test'
import assert from 'node:assert/strict'
import { legacyMatch,newCard,retryAt,sourceUid } from '../scripts/catalog-core.mjs'
test('source identity separates languages and preserves alphanumeric local IDs',()=>{
 const c = newCard({id:'sv1-TG01',localId:'TG01',name:'Pikachu'},'sv1','en','INT')
 assert.equal(c.source_card_id,'sv1-TG01'); assert.equal(c.source_uid,'tcgdex:en:sv1-TG01')
 assert.notEqual(sourceUid('en','x'),sourceUid('ja','x')); assert.equal(c.image_status,'missing')
})
test('MFB reconciles original Arcanine position with real source ID',()=>{
 const legacy={id:1,nome:'Arcanine',numero:1,variante:'normale'}
 const source={id:'mfb-14',name:'Arcanine',localId:'14'}
 assert.equal(legacyMatch([legacy],[source],source,'mfb').match.id,1)
})
test('ambiguous MFB originals are reported instead of duplicated or guessed',()=>{
 const original={nome:'Pikachu',numero:1,variante:'normale'}
 const source={name:'Pikachu',id:'mfb-1'}
 assert.equal(legacyMatch([original],[source,{...source,id:'mfb-2'}],source,'mfb').ambiguous,true)
})
test('legacy normal and reverse are not merged',()=>{
 const source={localId:'001'}
 assert.equal(legacyMatch([{numero:1,variante:'reverse'}],[source],source,'s8a').match,null)
})
test('retries progress and eventually stabilize at monthly checks',()=>{
 const start=Date.UTC(2026,0,1)
 assert.equal(Date.parse(retryAt(1,false,start))-start,86400000)
 assert.equal(Date.parse(retryAt(10,false,start))-start,30*86400000)
 assert.equal(Date.parse(retryAt(1,true,start))-start,3600000)
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {explainObservations,suggestObservation,resultPhoto,evidenceSource} from '../src/lib/identification-evidence.ts'
test('missing evidence stays unknown and a negative answer is not treated as absent',()=>{
 const e=explainObservations({shiny:false,extra_mark:true},{shiny:false,extra_mark:false,pattern_stars:true,mark_top_left:null})
 assert.deepEqual(e.matched.map(x=>x.key),['shiny'])
 assert.deepEqual(e.different.map(x=>x.key),['extra_mark'])
 assert.deepEqual(e.unknown.map(x=>x.key),['pattern_stars'])
})
test('next question needs both documented answers and excludes questions already answered',()=>{
 const rows=[{known_facts:{shiny:true,extra_mark:true}},{known_facts:{shiny:false,extra_mark:true}},{known_facts:{extra_mark:true}}]
 const q=suggestObservation(rows,{})
 assert.equal(q.key,'shiny');assert.equal(q.yes,1);assert.equal(q.no,1);assert.equal(q.unknown,1);assert.equal(q.total,3)
 assert.equal(suggestObservation(rows,{shiny:false}),null)
 assert.equal(suggestObservation(rows,{},['shiny']),null)
 assert.equal(suggestObservation([{known_facts:{}},{known_facts:{}}],{}),null)
})
test('photo labels distinguish a reference, an associated image and a broken image',()=>{
 const m={image_url:null,reference_image_url:'reference'}
 assert.equal(resultPhoto(m).reference,true)
 assert.equal(resultPhoto(m,true).url,null);assert.equal(resultPhoto(m,true).label,'Foto non disponibile')
 assert.equal(resultPhoto({...m,image_url:'exact'}).url,'exact')
 assert.equal(resultPhoto({...m,reference_image_url:null}).label,'Senza foto')
})
test('evidence links permit HTTPS sources without credentials',()=>{
 assert.equal(evidenceSource('https://api.tcgdex.net/v2/en/cards/base1-1').host,'api.tcgdex.net')
 for(const value of ['javascript:alert(1)','http://example.com','https://user:secret@example.com',null])assert.equal(evidenceSource(value),null)
})

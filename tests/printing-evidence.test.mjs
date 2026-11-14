import {test} from 'node:test'
import assert from 'node:assert/strict'
import {printingScope,printingFieldValues,comparePrintings,printingLink} from '../src/lib/printing-evidence.ts'
const base={tags:['rarity:c'],source_payload:{metadata_scope:'card-metadata-only'}}
test('general card metadata does not establish a finish or stamp',()=>{
 assert.equal(printingScope(base),'card');assert.deepEqual(printingFieldValues(base,'finish:'),[])
 assert.deepEqual(printingFieldValues(base,'stamp:'),[])
})
test('a missing feature is unknown rather than a difference, while explicit normal and holo differ',()=>{
 const unknown=comparePrintings(base,{tags:['finish:holo']})
 assert.equal(unknown.find(f=>f.prefix==='finish:').status,'unknown')
 const explicit=comparePrintings({tags:['finish:normal','stamp:staff']},{tags:['finish:holo','stamp:staff']})
 assert.equal(explicit.find(f=>f.prefix==='finish:').status,'different')
 assert.equal(explicit.find(f=>f.prefix==='stamp:').status,'same')
})
test('sharing a selected printing preserves the card URL and escapes the exact entry identity',()=>{
 const value=printingLink('https://example.com/carta/42?other=keep','atlas-metadata:42 / example')
 const u=new URL(value)
 assert.equal(u.pathname,'/carta/42');assert.equal(u.searchParams.get('other'),'keep')
 assert.equal(u.searchParams.get('stampa'),'atlas-metadata:42 / example');assert.equal(u.hash,'#stampe')
})
test('MFB blue border is compared only when explicitly documented',()=>{
 const rows=comparePrintings({tags:[],facts:{blue_border_visible:false}},{tags:[],facts:{blue_border_visible:true}})
 assert.equal(rows.find(r=>r.prefix==='subtype:').status,'different')
 assert.deepEqual(printingFieldValues({tags:[],facts:{}},'subtype:'),[])
 assert.deepEqual(printingFieldValues({tags:['rarity:none']},'rarity:'),['Nessuna rarità indicata dalla fonte'])
})

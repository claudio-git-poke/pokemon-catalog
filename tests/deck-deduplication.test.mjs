import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {uniqueDeckEntries,deckEntry} from '../scripts/deck-mappings.mjs'
test('identical deck copies are written once; real positions and variants remain separate',()=>{
 const first={entry_key:'wcd:deck:unnumbered:1',source_payload:{player:'A',number:'87'}}
 const position={...first,entry_key:'ba:deck:2:1'}
 const variant={...first,entry_key:'wcd:other-deck:unnumbered:1'}
 const result=uniqueDeckEntries([first,structuredClone(first),position,variant])
 assert.equal(result.entries.length,3);assert.equal(result.duplicates,1);assert.deepEqual(result.conflicts,[])
})
test('same identity with conflicting facts is suspended instead of silently choosing a row',()=>{
 const result=uniqueDeckEntries([{entry_key:'same',tags:['finish:normal']},{entry_key:'same',tags:['finish:holo']},{entry_key:'safe',tags:[]}])
 assert.deepEqual(result.entries.map(e=>e.entry_key),['safe']);assert.deepEqual(result.conflicts,['same'])
})
test('the real WCD manifest contains repeated copies and produces unique upsert identities',async()=>{
 const rows=JSON.parse(await readFile(new URL('../data/catalog-world-decks.json',import.meta.url),'utf8'))
 const ids=new Map();const entries=rows.map(r=>{const identity=[r.set_id,r.local_id,r.name].join(':');if(!ids.has(identity))ids.set(identity,ids.size+1);return deckEntry({id:ids.get(identity),nome:r.name,sigla:r.set_id,lingua:'INT'},r)})
 const result=uniqueDeckEntries(entries)
 assert.ok(result.duplicates>0);assert.equal(new Set(result.entries.map(e=>e.entry_key)).size,result.entries.length)
})

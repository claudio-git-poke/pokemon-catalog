import {test} from 'node:test'
import assert from 'node:assert/strict'
import {canonicalTag,tagVariants,tagLabel,canonicalTags,familyOptions} from '../src/lib/metadata-vocabulary.mjs'
test('variants of the same value in different languages share one code and label',()=>{
 for(const t of ['stage:basis','stage:base','stage:basico','stage:basic'])assert.equal(canonicalTag(t),'stage:basic')
 assert.equal(canonicalTag('type:wasser'),'type:water');assert.equal(tagLabel('type:eau'),'Acqua')
 assert.equal(canonicalTag('card-type:サポート'),'card-type:supporter');assert.equal(canonicalTag('rarity:rare-sar'),'rarity:special-illustration-rare')
 assert.equal(canonicalTag('rarity:magnifique-rare'),'rarity:magnifique-rare','unknown variants stay as they are')
 assert.ok(tagVariants('stage:stage-1').includes('stage:livello-1'))
 assert.deepEqual(canonicalTags(['type:fuoco','type:fire','finish:holo']),['type:fire','finish:holo'])
 assert.ok(familyOptions('rarity').some(o=>o.code==='rarity:double-rare'&&o.label==='Doppia rara'))
})

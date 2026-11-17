import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {searchableMetadataTags,metadataPayload} from '../scripts/card-metadata-tags.mjs'
import {rarityTags,cardMetadataEntry} from '../scripts/card-metadata.mjs'
import {metadataQuery,metadataEvidence} from '../scripts/tcgdex-metadata-pages.mjs'
import {backfillCardMetadata} from '../scripts/metadata-backfill.mjs'
const detail={id:'sv02-269',localId:'269',name:'Example',set:{id:'sv02',name:'Evoluzioni a Paldea'},types:['Fuoco'],rarity:'Rara illustrazione speciale',stage:'Livello 1',regulationMark:'G',hp:90,illustrator:'Mitsuhiro Arita'}
test('translated metadata produces canonical searchable tags without inventing a finish or an image',()=>{
 const tags=searchableMetadataTags(detail,'it')
 for(const tag of ['type:fire','type:fuoco','stage:stage-1','hp:90','regulation:g','illustrator:mitsuhiro-arita'])assert.ok(tags.includes(tag),tag)
 assert.ok(!tags.some(t=>/^(finish|pattern|stamp):/.test(t)))
 const row=cardMetadataEntry({id:1,nome:'Mio nome',sigla:'SV02@IT',lingua:'IT',source_language:'it'},detail)
 assert.ok(row.tags.includes('type:fire'));assert.equal(row.source_payload.hp,90);assert.equal(row.source_payload.illustrator,'Mitsuhiro Arita');assert.equal(row.image_url,undefined)
 assert.equal(metadataPayload({...detail,hp:null},'it').hp,null)
})
test('ACE SPEC and Black White Rare aliases cover the official localized labels and canonical codes',()=>{
 for(const [lang,label,code]of [['en','ACE SPEC Rare','ace-spec-rare'],['it','rara ASSO TATTICO','ace-spec-rare'],['en','Black White Rare','black-white-rare'],['fr','Rare Noir Blanc','black-white-rare']])assert.ok(rarityTags(label,lang).includes('rarity:'+code))
 assert.ok(rarityTags('ACE SPEC Rare').includes('rarity:ace'));assert.ok(rarityTags('Black White Rare').includes('rarity:bwr'))
})
test('special categories require explicit source rarity, suffix, trainer type or a literal source-name mark',()=>{
 assert.ok(searchableMetadataTags({rarity:'Radiant Rare'}).includes('category:radiant'))
 assert.ok(searchableMetadataTags({suffix:'Alleati'},'it').includes('category:tag-team'))
 assert.ok(searchableMetadataTags({suffix:'ESCOUADE'},'fr').includes('category:tag-team'))
 assert.ok(searchableMetadataTags({name:'Lunala ◇'}).includes('category:prism-star'))
 assert.ok(searchableMetadataTags({name:'Rayquaza ☆'}).includes('category:gold-star'))
 assert.ok(searchableMetadataTags({name:'Charizard ☆ δ'}).includes('category:gold-star'))
 assert.ok(searchableMetadataTags({rarity:'ACE SPEC Rare'}).includes('category:ace-spec'))
 assert.deepEqual(searchableMetadataTags({name:'Shiny golden rare',rarity:'Unknown',hp:'90'}),[])
})
test('GraphQL pages preserve exact language and identity, reject errors and never include pricing or finish',()=>{
 const query=metadataQuery('it',2,500);assert.ok(query.includes('filters:{}'));assert.ok(query.includes('@locale(lang:"it")'));assert.ok(!query.includes('pricing'))
 const rows=metadataEvidence('it',{data:{cards:[detail]}},2)
 assert.equal(rows[0].source_uid,'tcgdex:it:sv02-269');assert.equal(rows[0].metadata.source_language,'it')
 assert.throws(()=>metadataEvidence('it',{errors:[{message:'upstream failure'}],data:{cards:[]}},2),/Invalid/)
 assert.throws(()=>metadataEvidence('it',{data:{cards:[detail,detail]}},2),/duplicate/)
 assert.throws(()=>metadataEvidence('it',{data:{cards:[{...detail,localId:'268'}]}},2),/identity/)
 assert.throws(()=>metadataQuery('it") { injected }',1),/Invalid/)
})
test('an incomplete metadata page is repeated rather than skipped, and completed languages are skipped on immediate retries',async()=>{
 let state=[],defer=true,calls=[]
 const db={from(){let value;return {select(){return Promise.resolve({data:state,error:null})},upsert(row){value=row;state=[row];return Promise.resolve({data:[row],error:null})}}},async rpc(){return {data:{updated:1,matched:1,deferred:defer?1:0},error:null}}}
 const page=async(language,n)=>{calls.push(n);return n===1?[{source_uid:'tcgdex:it:sv02-269'}]:[]}
 let result=await backfillCardMetadata({db,fetchPage:page,languages:['it'],version:'test',log:()=>{},clock:()=>1000,deadline:100000})
 assert.ok(result.deferred>0);assert.equal(state.length,0,'no bookmark advances before all rows are published')
 defer=false;result=await backfillCardMetadata({db,fetchPage:page,languages:['it'],version:'test',log:()=>{},clock:()=>1000,deadline:100000})
 assert.equal(result.deferred,0);assert.ok(state[0].completed_at);assert.equal(state[0].next_page,1)
 calls=[];await backfillCardMetadata({db,fetchPage:page,languages:['it'],version:'test',log:()=>{},clock:()=>2000,deadline:100000});assert.deepEqual(calls,[])
 state=[{source_language:'it',next_page:8,mapping_version:'test',completed_at:null}];calls=[]
 await backfillCardMetadata({db,fetchPage:page,languages:['it'],version:'test',log:()=>{},clock:()=>2000,deadline:100000})
 assert.equal(calls[0],8,'an interrupted cycle resumes after earlier acknowledged pages')
})

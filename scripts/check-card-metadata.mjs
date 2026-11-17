import assert from 'node:assert/strict'
export async function verifyCardMetadata(get){
 const read=async params=>get('catalog_search_entries?'+new URLSearchParams({select:'entry_key,tags,source_payload',limit:'1',...params}))
 const italian=await read({entry_key:'eq.card:170001'})
 assert.ok(italian[0]?.tags.includes('rarity:secret-rare'),'High-ID Italian cards must include documented Secret Rare metadata')
 for(const language of ['INT','IT']){
  const rows=await read({language:'eq.'+language,tags:'cs.{type:fire,regulation:g}',verification:'eq.catalog'})
  assert.equal(rows.length,1,'Missing canonical Fire / regulation G in '+language)
  const row=rows[0],p=row.source_payload
  assert.ok(Number.isInteger(p.hp));assert.ok(p.stage);assert.ok(p.illustrator)
  assert.ok(row.tags.includes('hp:'+p.hp));assert.ok(row.tags.some(t=>t.startsWith('stage:')));assert.ok(row.tags.some(t=>t.startsWith('illustrator:')))
 }
 for(const code of ['ace-spec-rare','black-white-rare'])assert.ok((await read({language:'eq.INT',tags:'cs.{rarity:'+code+'}'})).length,code)
 for(const code of ['radiant','prism-star','gold-star','tag-team','ace-spec'])assert.ok((await read({language:'eq.INT',tags:'cs.{category:'+code+'}'})).length,'Missing '+code)
 console.log(JSON.stringify({check:'card-metadata-fields',high_id_italian:true,western_types_regulation_hp_stage_illustrator:true,special_categories:true,ace_spec:true,black_white_rare:true}))
}

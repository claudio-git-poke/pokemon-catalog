import {normalizeSearch} from '../src/lib/catalog-identification.ts'
const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
export const printedNumber=x=>String(x??'').replace(/^0+(?=\d)/,'').toLowerCase()
export function sourceIdentities(row){
 if(!row.set_id||!row.local_id)return []
 const raw=String(row.local_id),n=printedNumber(raw),ids=[raw,n,raw.toUpperCase(),raw.toLowerCase()]
 if(/^\d+$/.test(n))ids.push(n.padStart(3,'0'))
 return [...new Set(ids)].map(id=>`tcgdex:en:${row.set_id}-${id}`)
}
export async function releaseCardIndex(db,rows){
 const uids=[...new Set(rows.flatMap(sourceIdentities))],cards=new Map()
 for(let n=0;n<uids.length;n+=200)for(const c of await check(db.from('cards').select('id,nome,sigla,lingua,numero,source_uid,source_card_id,source_local_id,source_language,manual_overrides').in('source_uid',uids.slice(n,n+200))))cards.set(c.id,c)
 // Legacy fallback is only needed for sources without an exact indexed identity.
 const absentSets=[...new Set(rows.filter(r=>r.set_id&&!sourceIdentities(r).some(uid=>[...cards.values()].some(c=>c.source_uid===uid))).map(r=>r.set_id))]
 for(const set of absentSets){
  const aliases=[set,set.toUpperCase(),set+'@INT',set.toUpperCase()+'@INT']
  for(let offset=0;;offset+=500){const page=await check(db.from('cards').select('id,nome,sigla,lingua,numero,source_uid,source_card_id,source_local_id,source_language,manual_overrides').is('source_uid',null).in('sigla',aliases).eq('lingua','INT').order('id').range(offset,offset+499));for(const c of page)cards.set(c.id,c);if(page.length<500)break}
 }
 return [...cards.values()]
}
export function resolveReleaseCard(row,cards){
 if(!row.set_id||!row.local_id)return {reason:'printing_identity_undocumented'}
 const identities=sourceIdentities(row),exact=cards.filter(c=>identities.includes(c.source_uid))
 if(exact.length===1)return {card:exact[0],method:'exact_source_identity'}
 if(exact.length>1)return {reason:'ambiguous_source_identity'}
 const candidates=cards.filter(c=>!c.source_uid&&(!c.source_language||c.source_language==='en')&&
  (c.sigla||'').split('@')[0].toLowerCase()===row.set_id.toLowerCase()&&
  printedNumber(c.source_local_id||c.numero)===printedNumber(row.local_id)&&normalizeSearch(c.nome||'')===normalizeSearch(row.name))
 return candidates.length===1?{card:candidates[0],method:'unique_legacy_set_number_name'}:{reason:candidates.length?'ambiguous_legacy_identity':'source_card_not_linked'}
}

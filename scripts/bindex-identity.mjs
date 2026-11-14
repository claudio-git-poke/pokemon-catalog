import {TAXONOMY} from '../src/lib/catalog-taxonomy.ts'
import {expandTags,normalizeSearch} from '../src/lib/catalog-identification.ts'
export const stableKey=r=>JSON.stringify([r.sigla,r.numero,r.variante])
export const number=value=>String(value??'').replace(/^0+(?=\d)/,'').toLowerCase()
export function referenceTags(row){
 const tags=[],sigla=row.sigla,v='-'+row.variante+'-'
 for(const t of TAXONOMY)if(['stamp','subtype','pattern'].includes(t.kind)&&v.includes('-'+t.code.split(':')[1]+'-'))tags.push(t.code)
 if(row.variante.startsWith('holo'))tags.push('finish:holo')
 if(row.variante.startsWith('reverse'))tags.push('finish:reverse')
 if(row.variante==='metal')tags.push('finish:metal')
 const family=sigla==='MFB'?'my-first-battle':/^BOO(?:\d{2})?$/.test(sigla)?'trick-or-trade':/^PPS\d+$/.test(sigla)?'prize-pack':/^WCD\d{2}$/.test(sigla)?'world-championships':/^BA\d{2}$/.test(sigla)?'battle-academy':null
 if(family)tags.push('family:'+family)
 // A legacy 'normale' key can be the only holo printing. It does not establish a non-holo finish.
 return expandTags(tags)
}
export function variantKey(variant,hasNormal){
 if(!variant?.type)return null
 const base=variant.type==='normal'?'normale':variant.type==='holo'?(hasNormal===undefined?null:hasNormal?'holo':'normale'):['reverse','metal','lenticular'].includes(variant.type)?variant.type:null
 if(!base)return null
 const extras=[variant.foil,variant.subtype,...(variant.stamp||[])].filter(x=>x&&x!=='30th-anniversary')
 if(extras.some(x=>typeof x!=='string'||! /^[a-z0-9]+(-[a-z0-9]+)*$/.test(x)))return null
 if(variant.size==='jumbo')extras.push('jumbo')
 const suffix=[...new Set(extras)].join('-')
 return (variant.type==='holo'&&suffix?'holo':base)+(suffix?'-'+suffix:'')
}
export const equivalentVariant=(a,b)=>{const parts=x=>x.replace(/^normale(?=-|$)/,'normal').split('-').sort().join('-');return parts(a)===parts(b)}
const firstNames=new Map([['Pozione','Potion'],['Scambio','Switch'],['Energia base Fuoco','Fire Energy'],['Energia base Erba','Grass Energy'],['Energia base Lampo','Lightning Energy'],['Energia base Acqua','Water Energy']].map(([a,b])=>[normalizeSearch(a),normalizeSearch(b)]))
const mfbName=x=>firstNames.get(normalizeSearch(x))||normalizeSearch(x)
export function resolvePublication(entry,card,sets,reference){
 const payload=entry.source_payload||{},variant=payload.variant,cm=variant?.thirdParty?.cardmarket
 const mfb=entry.tags.includes('family:my-first-battle')
 const sourceSet=(payload.set?.id||card?.sigla?.split('@')[0]||entry.set_code.split('@')[0]).toLowerCase()
 const canonical=mfb?sets.find(s=>s.sigla==='MFB'):sets.find(s=>s.lingua==='INT'&&s.tcgdex_id?.toLowerCase()===sourceSet)
 if(!['INT','EN','IT','FR','DE','ES','PT'].includes(entry.language))return {reason:'asian_ordinal_requires_verified_page'}
 if(!variant)return resolveCurated(entry,card,sets,reference)
 if(!canonical)return {reason:'set_alias_unconfirmed'}
 if(cm&&reference.some(r=>r.cardmarket_id===cm&&r.sigla!==canonical.sigla))return {reason:'product_namespace_requires_review'}
 const proposed=variantKey(variant,payload.has_normal_variant)
 const candidates=cm?reference.filter(r=>r.sigla===canonical.sigla&&r.cardmarket_id===cm&&(!mfb||mfbName(r.nome)===mfbName(card.nome))):[]
 const printed=entry.collector_number
 const numeric=printed&&/^\d+$/.test(printed)&&Number(printed)>0
 const coherent=candidates.filter(r=>mfb||!numeric||r.numero===Number(printed))
 const exact=coherent.filter(r=>proposed&&equivalentVariant(r.variante,proposed))
 if(payload.product_variant_count>1&&coherent.length===1&&exact.length!==1)return {reason:'ambiguous_source_product_id'}
 if(coherent.length===1)return {row:coherent[0],method:'cardmarket+set+identity',cm}
 if(exact.length===1)return {row:exact[0],method:'cardmarket+set+variant',cm}
 if(coherent.length>1)return {reason:'ambiguous_product_variants'}
 if(mfb)return {reason:'mfb_product_identity_unverified'}
 if(candidates.length)return {reason:'product_number_conflict'}
 if(!numeric||!proposed)return {reason:'number_or_variant_unconfirmed'}
 const matches=reference.filter(r=>r.sigla===canonical.sigla&&r.numero===Number(printed)&&equivalentVariant(r.variante,proposed))
 if(matches.length>1)return {reason:'equivalent_legacy_variants_ambiguous'}
 const existing=matches[0]
 if(existing){if(cm&&existing.cardmarket_id&&cm!==existing.cardmarket_id)return {reason:'product_identity_conflict'};return {row:existing,method:'set+printed_number+variant',cm}}
 // No globally reused product ID may create a different printing by accident.
 if(cm&&reference.some(r=>r.cardmarket_id===cm&&r.sigla===canonical.sigla))return {reason:'reused_product_id'}
 return {row:{sigla:canonical.sigla,numero:Number(printed),variante:proposed,nome:payload.source_name||card.nome,rarita:payload.rarity||null,codice:`${canonical.sigla} ${String(Number(printed)).padStart(3,'0')}`,cardmarket_id:cm||null,cardmarket_url:null,immagine:null,immagine_hd:null,tag:[],eliminata:false},method:'new_explicit_source_variant',created:true,cm}
}

function resolveCurated(entry,card,sets,reference){
 const year=entry.release_year,p=entry.source_payload||{}
 const family=entry.tags.find(t=>t.startsWith('family:'))
 const sigla=family==='family:trick-or-trade'?(year===2022?'BOO':'BOO'+String(year).slice(-2)):family==='family:prize-pack'?'PPS'+entry.release_code?.split('-').at(-1):family==='family:world-championships'?'WCD'+String(year).slice(-2):family==='family:battle-academy'?'BA'+String(year).slice(-2):null
 if(!sigla||!sets.some(s=>s.sigla===sigla))return {reason:'curated_release_unconfirmed'}
 let candidates=reference.filter(r=>r.sigla===sigla)
 if(family==='family:battle-academy'){
  if(year!==2024||!entry.deck_number)return {reason:'deck_page_identity_unconfirmed'}
  const prefix={armarouge:'A',pikachu:'P'}[entry.deck_code];if(!prefix)return {reason:'deck_code_unconfirmed'}
  candidates=candidates.filter(r=>r.codice===prefix+entry.deck_number)
 }else{
  const origin=(p.set_id||card?.sigla?.split('@')[0]||'').toLowerCase(),set=sets.find(s=>s.lingua==='INT'&&s.tcgdex_id?.toLowerCase()===origin)
  if(!set||!entry.collector_number)return {reason:'origin_code_unconfirmed'}
  candidates=candidates.filter(r=>{const parts=(r.codice||'').split(' ');return parts[0]===set.sigla&&number(parts[1])===number(entry.collector_number)})
 }
 if(candidates.length!==1)return {reason:'curated_page_ambiguous_or_missing'}
 return {row:candidates[0],method:'release+documented_origin_or_deck_position'}
}

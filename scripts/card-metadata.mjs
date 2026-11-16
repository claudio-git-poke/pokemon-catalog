import {readFileSync} from 'node:fs'
import {normalizeSearch} from '../src/lib/catalog-identification.ts'
const aliases=JSON.parse(readFileSync(new URL('../data/catalog-rarity-aliases.json',import.meta.url),'utf8')).languages
export function rarityTags(rarity,language='en'){
 if(typeof rarity!=='string'||!rarity.trim())return []
 const normalized=normalizeSearch(rarity),raw='rarity:'+normalized.replaceAll(' ','-')
 const canonical=aliases[language]?.[normalized]||aliases.en[normalized]
 return [...new Set([raw,canonical].filter(Boolean))]
}
export function cardMetadataEntry(card,detail){
 const mfb=(card.sigla||'').split('@')[0].toLowerCase()==='mfb'
 return {entry_key:'card:'+card.id,card_id:card.id,collector_number:mfb?null:String(detail.localId||card.source_local_id||card.numero||'').replace(/^0+(?=\d)/,''),
  name:card.nome||'',set_code:card.sigla||'',language:card.lingua||'',tags:[...(mfb?['family:my-first-battle']:[]),...rarityTags(detail.rarity,card.source_language)],
  source_url:`https://api.tcgdex.net/v2/${card.source_language}/cards/${encodeURIComponent(detail.id)}`,
  source_payload:{id:detail.id,rarity:detail.rarity??null,set:detail.set,source_language:card.source_language,metadata_scope:'card-metadata-only',reference_image_only:true},verification:'catalog',updated_at:new Date().toISOString()}
}

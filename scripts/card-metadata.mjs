import {readFileSync} from 'node:fs'
import {normalizeSearch} from '../src/lib/catalog-identification.ts'
const aliases=JSON.parse(readFileSync(new URL('../data/catalog-rarity-aliases.json',import.meta.url),'utf8')).languages
export function rarityTags(rarity,language='en'){
 if(typeof rarity!=='string'||!rarity.trim())return []
 const normalized=normalizeSearch(rarity),raw='rarity:'+normalized.replaceAll(' ','-')
 if(!normalized)return []
 const canonical=aliases[language]?.[normalized]||aliases.en[normalized]
 return [...new Set([raw,...(Array.isArray(canonical)?canonical:[canonical])].filter(Boolean))]
}
export const knownRarity=(rarity,language='en')=>typeof rarity==='string'&&!!(aliases[language]?.[normalizeSearch(rarity)]||aliases.en[normalizeSearch(rarity)])
export function cardMetadataEntry(card,detail,facts={}){
 const mfb=(card.sigla||'').split('@')[0].toLowerCase()==='mfb'
 return {entry_key:'card:'+card.id,card_id:card.id,collector_number:mfb?null:String(detail.localId||card.source_local_id||card.numero||'').split('/')[0].replace(/^0+(?=\d)/,'').toLowerCase(),
  facts,label:'Variante non ancora identificata',search_text:normalizeSearch([card.nome,card.sigla,card.codice].filter(Boolean).join(' ')),
  name:card.nome||'',set_code:card.sigla||'',language:card.lingua||'',tags:[...(mfb?['family:my-first-battle']:[]),...rarityTags(detail.rarity,card.source_language)],
  source_url:`https://api.tcgdex.net/v2/${card.source_language}/cards/${encodeURIComponent(detail.id)}`,
  source_payload:{id:detail.id,rarity:detail.rarity??null,set:detail.set,source_language:card.source_language,metadata_scope:'card-metadata-only',reference_image_only:true},verification:'catalog',updated_at:new Date().toISOString()}
}

export async function reportedMetadataCards(db){
 const check=async q=>{const{data,error}=await q;if(error)throw Error(error.message);return data}
 const source=[]
 for(const language of ['en','it'])source.push(...await check(db.from('cards').select('*').like('source_uid',`tcgdex:${language}:sv02-%`).order('id').limit(300)))
 const entries=[]
 for(let n=0;n<source.length;n+=200)entries.push(...await check(db.from('catalog_search_entries').select('card_id,source_payload,manual_overrides').in('card_id',source.slice(n,n+200).map(c=>c.id)).eq('verification','catalog')))
 const byId=new Map(entries.map(e=>[e.card_id,e])),reported=new Set(['232','245','254','262','269'])
 return source.filter(c=>{const e=byId.get(c.id);return !e?.source_payload?.rarity&&!Object.hasOwn(e?.manual_overrides||{},'source_payload')})
  .sort((a,b)=>Number(reported.has(b.source_local_id))-Number(reported.has(a.source_local_id)))
}

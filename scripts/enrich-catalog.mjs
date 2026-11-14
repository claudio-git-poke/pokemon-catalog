import {mapVariant,termsForEntries} from './variant-mappings.mjs'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {sourcePrinting,expandTags,printingFacts,normalizeSearch} from '../src/lib/catalog-identification.ts'
const now=()=>new Date().toISOString()
const normNumber=value=>String(value||'').split('/')[0].replace(/^0+(?=\d)/,'').toLowerCase()
const check=async query=>{const{data,error}=await query;if(error)throw Error(error.message);return data}
export function baseFacts(card){
 const facts={}
 if(['JP','KOR','CHN','CHN-T','TH','INT','EN','IT','FR','DE','ES','PT','ID'].includes(card.lingua))facts.asian_script=['JP','KOR','CHN','CHN-T','TH'].includes(card.lingua)
 for(const[key,re]of Object.entries({name_has_lv:/(?:^|\s)LV\.?/i,name_has_ex:/(?:^|\s)ex(?:$|\s)/i,name_has_gx:/(?:^|[\s-])GX(?:$|\s)/i,name_has_vmax:/(?:^|\s)VMAX(?:$|\s)/i,name_has_vstar:/(?:^|\s)VSTAR(?:$|\s)/i}))if(card.nome)facts[key]=re.test(card.nome)
 return facts
}
export function detailEntries(card,detail){
 const lang=card.source_language
 const raw=Array.isArray(detail.variants_detailed)&&detail.variants_detailed.length?detail.variants_detailed:Array.isArray(detail.variants)?detail.variants:[...Object.entries(detail.variants||{}).filter(([key,value])=>value===true&&['normal','holo','reverse'].includes(key)).map(([type])=>({type})),...Object.entries(detail.variants||{}).filter(([key,value])=>value===true&&['firstEdition','wPromo','preRelease','jumbo'].includes(key)).map(([key])=>key==='jumbo'?{size:'jumbo'}:{stamp:[{firstEdition:'1st-edition',wPromo:'w-promo',preRelease:'pre-release'}[key]]})]
 return raw.filter(v=>!v.languages||v.languages.includes(lang)).map(v=>{
  const {pricing,...clean}=v
  if(!clean.stamp&&Array.isArray(clean.stamps))clean.stamp=clean.stamps
  const {tags,facts,attributes}=mapVariant(card,detail,clean)
  if((card.sigla||'').split('@')[0].toLowerCase()==='mfb')tags.push('family:my-first-battle')
  const key=v.variantId || createHash('sha256').update(JSON.stringify({...clean,thirdParty:undefined})).digest('hex').slice(0,24)
  return {entry_key:`tcgdex:${card.id}:${key}`,card_id:card.id,collector_number:tags.includes('family:my-first-battle')?null:normNumber(detail.localId),denominator:tags.includes('family:my-first-battle')?null:detail.set?.cardCount?.official?String(detail.set.cardCount.official):null,release_year:attributes.release_year||null,deck_code:attributes.deck||null,deck_number:null,
   name:card.nome,set_code:card.sigla,language:card.lingua,tags:expandTags(tags),facts:{...baseFacts(card),...facts},
   source_url:`https://api.tcgdex.net/v2/${lang}/cards/${encodeURIComponent(detail.id)}`,source_payload:{id:detail.id,localId:detail.localId,set:detail.set,rarity:detail.rarity,source_name:detail.name,source_language:lang,product_variant_count:clean.thirdParty?.cardmarket?raw.filter(x=>x.thirdParty?.cardmarket===clean.thirdParty.cardmarket).length:0,has_normal_variant:raw.some(x=>x.type==='normal'),variant:clean,attributes},verification:'source',
   label:[v.type,v.foil,v.subtype,...(v.stamp||[])].filter(Boolean).join(' · ')||'Stampa dichiarata dalla fonte',updated_at:now(),search_text:normalizeSearch(`${card.nome} ${card.sigla} ${detail.set?.name||''} ${card.codice||''}`)}
 })
}
export function curatedEntry(card,row){
 const family=row.family||'trick-or-trade',stamp=row.stamp||'trick-or-trade'
 const tags=expandTags(['family:'+family,'stamp:'+stamp,row.holo?'finish:holo':'finish:normal'])
 return {entry_key:`${row.release_code||'trick-or-trade-'+row.year}:${card.id}:${row.holo?'holo':'normal'}`,card_id:card.id,release_code:row.release_code||`trick-or-trade-${row.year}`,release_year:row.year,collector_number:normNumber(row.local_id.replace(/^[A-Za-z]+/,'')),denominator:row.printed_number.split('/')[1]||null,name:card.nome,set_code:card.sigla,language:card.lingua,tags,facts:{...baseFacts(card),...printingFacts(tags,{stamp:[stamp]})},source_url:row.source,source_payload:{...row,reference_image_only:true},verification:'source',label:`${row.release_name||'Trick or Trade '+row.year} · ${row.holo?'Holo':'Non-Holo'} · ${stamp==='trick-or-trade'?'Timbro zucca Pikachu':'Logo Play! Pokémon'}`,search_text:normalizeSearch(`${card.nome} ${card.sigla} ${row.release_name||'Trick or Trade'} ${row.year}`),updated_at:now()}
}
export async function enrichCatalog({db,log=console.log,budgetMs=60000,limit=100,fetchDetail,clock=Date.now}){
 const deadline=clock()+budgetMs
 const cards=await check(db.from('cards').select('*').not('source_card_id','is',null).lte('traits_next_attempt_at',now()).order('traits_next_attempt_at').order('id').limit(limit))
 if(!cards.length)return
 await log(`Identificazione: arricchimento di massimo ${cards.length} carte; stampini e finiture solo da metadati espliciti.`,true)
 let cursor=0
 async function consume(){while(cursor<cards.length){
  if(clock()>deadline-8000)break
  const card=cards[cursor++]
  if(card.source_uid&&!card.source_uid.startsWith('tcgdex:')){await check(db.from('cards').update({traits_next_attempt_at:new Date(Date.now()+30*86400000).toISOString(),traits_last_error:'Metadati dettagliati non disponibili per questa fonte.'}).eq('id',card.id));continue}
  try{
   const url=`https://api.tcgdex.net/v2/${card.source_language}/cards/${encodeURIComponent(card.source_card_id)}`
   const response=fetchDetail?await fetchDetail(card):await fetch(url,{signal:AbortSignal.timeout(7000)})
   const detail=fetchDetail?response:await (async()=>{if(!response.ok)throw Error(`TCGdex metadati HTTP ${response.status}`);return response.json()})()
   if(detail.id!==card.source_card_id)throw Error('Identità della fonte non corrispondente: nessun tag assegnato.')
   const entries=detailEntries(card,detail)
   if(entries.length){const terms=termsForEntries(entries);if(terms.length)await check(db.from('catalog_terms').upsert(terms,{onConflict:'code',ignoreDuplicates:true}));await check(db.from('catalog_search_entries').upsert(entries,{onConflict:'entry_key'}))}
   await check(db.from('cards').update({traits_checked_at:now(),traits_next_attempt_at:new Date(Date.now()+14*86400000).toISOString(),traits_last_error:null}).eq('id',card.id))
   await log(`Identificazione #${card.id} ${card.nome}: ${entries.length} stampe indicizzate, fonte ${detail.id}.`)
  }catch(error){await check(db.from('cards').update({traits_next_attempt_at:new Date(Date.now()+6*3600000).toISOString(),traits_last_error:String(error)}).eq('id',card.id));await log(`Identificazione #${card.id}: ${String(error)}; riprovo più tardi.`)}
 }}
 await Promise.all(Array.from({length:3},()=>consume()))
 await log('Arricchimento tag concluso; continuo importazioni e immagini.',true)
}
export async function syncCuratedReleases({db,log=console.log}){
 const rows=JSON.parse(await readFile(new URL('../data/catalog-releases.json',import.meta.url),'utf8'))
 let indexed=0,unresolved=0
 const cache=new Map(),entries=[]
 for(const row of rows){
  if(!cache.has(row.set_id))cache.set(row.set_id,await check(db.from('cards').select('*').eq('lingua','INT').in('sigla',[row.set_id,row.set_id.toUpperCase(),row.set_id.toUpperCase()+'@INT']).limit(1000)))
  const candidates=cache.get(row.set_id)
  const matches=candidates.filter(c=>normalizeSearch(c.nome)===normalizeSearch(row.name)&&normNumber(c.source_local_id||c.numero)===normNumber(row.local_id.replace(/^[A-Za-z]+/,''))).sort((a,b)=>Number(!!b.source_uid)-Number(!!a.source_uid)||a.id-b.id)
  if(!matches.length){unresolved++;continue}
  entries.push(curatedEntry(matches[0],row));indexed++
 }
 for(let i=0;i<entries.length;i+=100)await check(db.from('catalog_search_entries').upsert(entries.slice(i,i+100),{onConflict:'entry_key'}))
 await log(`Emissioni verificate: ${indexed}/${rows.length} stampe promozionali collegate; ${unresolved} in attesa della carta originale.`)
 return {indexed,unresolved}
}

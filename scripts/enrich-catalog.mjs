import {databaseError,isTransientDatabaseError} from './database-errors.mjs'
import {mapVariant,termsForEntries} from './variant-mappings.mjs'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {releaseCardIndex,resolveReleaseCard} from './release-card-links.mjs'
import {cardMetadataEntry} from './card-metadata.mjs'
import {metadataPayload,searchableMetadataTags} from './card-metadata-tags.mjs'
import {rarityTags} from './card-metadata.mjs'
import {sourcePrinting,expandTags,printingFacts,normalizeSearch} from '../src/lib/catalog-identification.ts'
const now=()=>new Date().toISOString()
const normNumber=value=>String(value||'').split('/')[0].replace(/^0+(?=\d)/,'').toLowerCase()
const check=async query=>{try{const{data,error}=await query;if(error)throw error;return data}catch(error){throw databaseError(error)}}
export function baseFacts(card){
 const facts={}
 if(['JP','KOR','CHN','CHN-T','TH','INT','EN','IT','FR','DE','ES','PT','ID','NL','PL','RU','ES-LA'].includes(card.lingua))facts.asian_script=['JP','KOR','CHN','CHN-T','TH'].includes(card.lingua)
 for(const[key,re]of Object.entries({name_has_lv:/(?:^|\s)LV\.?/i,name_has_ex:/(?:^|\s)ex(?:$|\s)/i,name_has_gx:/(?:^|[\s-])GX(?:$|\s)/i,name_has_vmax:/(?:^|\s)VMAX(?:$|\s)/i,name_has_vstar:/(?:^|\s)VSTAR(?:$|\s)/i}))if(card.nome)facts[key]=re.test(card.nome)
 return facts
}
const stableValue=value=>Array.isArray(value)?value.map(stableValue):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,stableValue(value[k])])):value
const digest=value=>createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex').slice(0,24)
function sourceVariants(raw,lang){
 const unique=new Map()
 for(const v of raw.filter(v=>!v.languages||v.languages.includes(lang))){
  const {pricing,...clean}=v
  if(!clean.stamp&&Array.isArray(clean.stamps))clean.stamp=clean.stamps
  // Preserve the historical fallback key for variants without an upstream ID.
  const base=clean.variantId||createHash('sha256').update(JSON.stringify({...clean,thirdParty:undefined})).digest('hex').slice(0,24)
  delete clean.stamps
  if(Array.isArray(clean.stamp))clean.stamp=[...new Set(clean.stamp)].sort()
  if(Array.isArray(clean.languages))clean.languages=[...new Set(clean.languages)].sort()
  if(!unique.has(digest(clean)))unique.set(digest(clean),{clean,base})
 }
 return [...unique].map(([fingerprint,row])=>({fingerprint,...row}))
}
export async function quarantineVariantCollisions(db,entries){
 const keys=[...new Set(entries.map(e=>e.source_payload.ambiguous_legacy_entry_key).filter(Boolean))]
 if(!keys.length)return
 const old=await check(db.from('catalog_search_entries').select('entry_key,source_payload').in('entry_key',keys).neq('verification','reviewed'))
 for(const row of old)await check(db.from('catalog_search_entries').update({source_payload:{...row.source_payload,identity_review_required:true,metadata_scope:'card-metadata-only',reference_image_only:true,identity_conflict:'reused_source_variant_id'},updated_at:now()}).eq('entry_key',row.entry_key).neq('verification','reviewed'))
}
export function detailEntries(card,detail){
 const lang=card.source_language
 const raw=Array.isArray(detail.variants_detailed)&&detail.variants_detailed.length?detail.variants_detailed:Array.isArray(detail.variants)?detail.variants:[...Object.entries(detail.variants||{}).filter(([key,value])=>value===true&&['normal','holo','reverse'].includes(key)).map(([type])=>({type})),...Object.entries(detail.variants||{}).filter(([key,value])=>value===true&&['firstEdition','wPromo','preRelease','jumbo'].includes(key)).map(([key])=>key==='jumbo'?{size:'jumbo'}:{stamp:[{firstEdition:'1st-edition',wPromo:'w-promo',preRelease:'pre-release'}[key]]})]
 const variants=sourceVariants(raw,lang),counts=new Map()
 for(const row of variants)counts.set(row.base,(counts.get(row.base)||0)+1)
 return variants.map(({clean:original,base,fingerprint})=>{
  const clean={...original}
  const types={normal:'normal',normale:'normal',holo:'holo',olografica:'holo',reverse:'reverse',metal:'metal',lenticular:'lenticular'}
  if(typeof clean.type==='string')clean.type=types[clean.type.toLowerCase()]||clean.type
  if(typeof clean.size==='string'&&['standard','jumbo'].includes(clean.size.toLowerCase()))clean.size=clean.size.toLowerCase()
  const collision=counts.get(base)>1
  const {tags,facts,attributes}=mapVariant(card,detail,clean)
  if((card.sigla||'').split('@')[0].toLowerCase()==='mfb')tags.push('family:my-first-battle')
  const key=collision?`${base}:source:${fingerprint}`:base
  return {entry_key:`tcgdex:${card.id}:${key}`,card_id:card.id,collector_number:tags.includes('family:my-first-battle')?null:normNumber(detail.localId),denominator:tags.includes('family:my-first-battle')?null:detail.set?.cardCount?.official?String(detail.set.cardCount.official):null,release_year:attributes.release_year||null,deck_code:attributes.deck||null,deck_number:null,
   name:card.nome,set_code:card.sigla,language:card.lingua,tags:expandTags(tags),facts:{...baseFacts(card),...facts},
   source_url:`https://api.tcgdex.net/v2/${lang}/cards/${encodeURIComponent(detail.id)}`,source_payload:{...metadataPayload(detail,lang),metadata_tags:[...rarityTags(detail.rarity,lang),...searchableMetadataTags(detail,lang)].sort(),product_variant_count:clean.thirdParty?.cardmarket?variants.filter(x=>x.clean.thirdParty?.cardmarket===clean.thirdParty.cardmarket).length:0,has_normal_variant:variants.some(x=>['normal','normale'].includes(String(x.clean.type).toLowerCase())),variant:clean,source_variant_values:{type:original.type,size:original.size},...(collision?{identity_review_required:true,identity_conflict:'reused_source_variant_id',ambiguous_legacy_entry_key:`tcgdex:${card.id}:${base}`}:{ }),attributes},verification:'source',
   label:[clean.type,clean.foil,clean.subtype,...(clean.stamp||[])].filter(Boolean).join(' · ')||'Stampa dichiarata dalla fonte',updated_at:now(),search_text:normalizeSearch(`${card.nome} ${card.sigla} ${detail.set?.name||''} ${card.codice||''} ${tags.join(' ')}`)}
 })
}
export function curatedEntry(card,row){
 const family=row.family||'trick-or-trade',stamp=row.stamp||'trick-or-trade'
 const tags=expandTags(['family:'+family,'stamp:'+stamp,row.holo?'finish:holo':'finish:normal'])
 return {entry_key:`${row.release_code||'trick-or-trade-'+row.year}:${card.id}:${row.holo?'holo':'normal'}`,card_id:card.id,release_code:row.release_code||`trick-or-trade-${row.year}`,release_year:row.year,collector_number:normNumber(row.local_id.replace(/^[A-Za-z]+/,'')),denominator:row.printed_number.split('/')[1]||null,name:card.nome,set_code:card.sigla,language:card.lingua,tags,facts:{...baseFacts(card),...printingFacts(tags,{stamp:[stamp]})},source_url:row.source,source_payload:{...row,printing_language:'en',reference_image_only:true},verification:'source',label:`${row.release_name||'Trick or Trade '+row.year} · ${row.holo?'Holo':'Non-Holo'} · ${stamp==='trick-or-trade'?'Timbro zucca Pikachu':'Logo Play! Pokémon'}`,search_text:normalizeSearch(`${card.nome} ${card.sigla} ${row.release_name||'Trick or Trade'} ${row.year}`),updated_at:now()}
}
export async function enrichCatalog({db,log=console.log,budgetMs=60000,limit=100,fetchDetail,clock=Date.now,onlyUnchecked=false,concurrency=3,onProgress=()=>{},cardRows}){
 const deadline=clock()+budgetMs
 const select=()=>db.from('cards').select('*').like('source_uid','tcgdex:%').not('source_card_id','is',null).lte('traits_next_attempt_at',now())
 const stats={attempted:0,checked:0,indexed:0,errors:0}
 let cards
 try{
  cards=cardRows?cardRows.slice(0,limit):await check(select().is('traits_checked_at',null).order('traits_next_attempt_at').order('id').limit(limit))
  if(!cardRows&&!cards.length&&!onlyUnchecked)cards=await check(select().not('traits_checked_at','is',null).order('traits_next_attempt_at').order('id').limit(limit))
 }catch(error){
  if(!isTransientDatabaseError(error))throw error
  await log(`Recupero tag rinviato prima della selezione: ${String(error)}. Nessuna carta segnata come controllata.`,true)
  return {...stats,errors:1,databaseUnavailable:true}
 }
 if(!cards.length)return stats
 await log(`Identificazione: arricchimento di massimo ${cards.length} carte; stampini e finiture solo da metadati espliciti.`,true)
 let cursor=0,sourceUnavailable=false,databaseUnavailable=false
 async function consume(){while(cursor<cards.length){
  if(clock()>deadline-8000||sourceUnavailable||databaseUnavailable)break
  const card=cards[cursor++]
  stats.attempted++
  if(card.source_uid&&!card.source_uid.startsWith('tcgdex:')){await check(db.from('cards').update({traits_next_attempt_at:new Date(Date.now()+30*86400000).toISOString(),traits_last_error:'Metadati dettagliati non disponibili per questa fonte.'}).eq('id',card.id));continue}
  let entries,detail
  try{
   const url=`https://api.tcgdex.net/v2/${card.source_language}/cards/${encodeURIComponent(card.source_card_id)}`
   const response=fetchDetail?await fetchDetail(card):await fetch(url,{signal:AbortSignal.timeout(7000)})
   detail=fetchDetail?response:await (async()=>{if(!response.ok)throw Error(`TCGdex metadati HTTP ${response.status}`);return response.json()})()
   if(detail.id!==card.source_card_id)throw Error('Identità della fonte non corrispondente: nessun tag assegnato.')
   entries=detailEntries(card,detail)
   await quarantineVariantCollisions(db,entries)
   const indexed=[...entries,cardMetadataEntry(card,detail,baseFacts(card))]
   const terms=termsForEntries(indexed);if(terms.length)await check(db.from('catalog_terms').upsert(terms,{onConflict:'code',ignoreDuplicates:true}))
   await check(db.from('catalog_search_entries').upsert(indexed,{onConflict:'entry_key'}))
   await check(db.from('cards').update({traits_checked_at:now(),traits_next_attempt_at:new Date(Date.now()+14*86400000).toISOString(),traits_last_error:null}).eq('id',card.id))
   stats.checked++;stats.indexed+=entries.length;onProgress({...stats})
  }catch(error){
   stats.errors++;onProgress({...stats})
   if(isTransientDatabaseError(error)){
    databaseUnavailable=true
    await log(`Identificazione #${card.id}: database temporaneamente indisponibile (${String(error)}). Sospendo il lotto; la carta resta da riprendere.`,true)
    continue
   }
   if(error.database)throw error
   if(/HTTP (429|503)\b/.test(String(error)))sourceUnavailable=true
   try{
    await check(db.from('cards').update({traits_next_attempt_at:new Date(Date.now()+6*3600000).toISOString(),traits_last_error:String(error)}).eq('id',card.id))
   }catch(saveError){
    if(!isTransientDatabaseError(saveError))throw saveError
    databaseUnavailable=true
    await log(`Identificazione #${card.id}: impossibile salvare il rinvio (${String(saveError)}). Sospendo il lotto senza segnare la carta come controllata.`,true)
    continue
   }
   await log(`Identificazione #${card.id}: ${String(error)}; riprovo più tardi.`)
   continue
  }
  await log(`Identificazione #${card.id} ${card.nome}: ${entries.length} stampe indicizzate, fonte ${detail.id}.`)
 }}
 await Promise.all(Array.from({length:Math.max(1,Math.min(3,Math.floor(concurrency)||1))},()=>consume()))
 await log(databaseUnavailable?'Arricchimento tag sospeso per database occupato; il lavoro salvato è conservato.':'Arricchimento tag concluso; continuo importazioni e immagini.',true)
 return {...stats,...(sourceUnavailable?{sourceUnavailable:true}:{}),...(databaseUnavailable?{databaseUnavailable:true}:{})}
}

export async function syncCuratedReleases({db,log=console.log}){
 const rows=JSON.parse(await readFile(new URL('../data/catalog-releases.json',import.meta.url),'utf8'))
 let indexed=0,unresolved=0
 const cards=await releaseCardIndex(db,rows),entries=[],issues=[]
 for(const row of rows){
  const result=resolveReleaseCard(row,cards)
  if(!result.card){unresolved++;issues.push({release_code:row.release_code,name:row.name,set_id:row.set_id,local_id:row.local_id,reason:result.reason});continue}
  entries.push(curatedEntry(result.card,row));indexed++
 }
 for(let i=0;i<entries.length;i+=100)await check(db.from('catalog_search_entries').upsert(entries.slice(i,i+100),{onConflict:'entry_key'}))
 await log(`Emissioni verificate: ${indexed}/${rows.length} stampe promozionali collegate; ${unresolved} in attesa della carta originale.`)
 return {indexed,unresolved,issues}
}

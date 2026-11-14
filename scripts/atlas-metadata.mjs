import {atlasCards,atlasSets,normalizedSet,normalizedNumber} from './atlas-source.mjs'
import {normalizeSearch} from '../src/lib/catalog-identification.ts'
import {baseFacts} from './enrich-catalog.mjs'
import {termsForEntries} from './variant-mappings.mjs'

const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
export function atlasMetadataEntry(card,detail,set){
 if(card.source_uid!==`atlas:${set.source_language}:${detail.id}`||card.source_card_id!==detail.id||card.lingua!==detail.localLanguage||normalizedSet(card.sigla)!==normalizedSet(set.set_id)||normalizedNumber(card.source_local_id)!==normalizedNumber(detail.localId))throw Error('Identità Card Atlas discordante: metadati non assegnati.')
 const hosts={ja:'www.pokemon-card.com',ko:'pokemoncard.co.kr','zh-tw':'asia.pokemon-card.com'}
 const source=new URL(detail.sourcePage)
 if(source.protocol!=='https:'||source.hostname!==hosts[set.source_language])throw Error('Pagina ufficiale della fonte non valida.')
 const m=detail.metadata||{},tags=[],facts={...baseFacts(card),asian_script:true}
 const code=x=>normalizeSearch(String(x)).replaceAll(' ','-')
 if(m.rarity&&code(m.rarity))tags.push('rarity:'+code(m.rarity))
 for(const type of Array.isArray(m.types)?m.types:[])if(code(type))tags.push('type:'+code(type))
 if(m.card_type&&code(m.card_type))tags.push('card-type:'+code(m.card_type))
 if(m.regulation&&/^[A-Z]$/.test(m.regulation))tags.push('regulation:'+m.regulation.toLowerCase())
 // Literal suffixes establish a card mechanic, never its foil, texture or stamp.
 const suffix=detail.name.match(/(?:LV[.]?X|VSTAR|VMAX|GX|EX|ex|V)$/u)?.[0]
 if(suffix){tags.push('category:'+suffix.toLowerCase().replace(/^lv[.]?x$/,'lv-x'));const key={ex:'name_has_ex',gx:'name_has_gx',vmax:'name_has_vmax',vstar:'name_has_vstar','lv.x':'name_has_lv',lvx:'name_has_lv'}[suffix.toLowerCase()];if(key)facts[key]=true}
 const number=detail.localId.startsWith('UNNUMBERED:')?null:normalizedNumber(detail.localId).toLowerCase()
 return {entry_key:`atlas-metadata:${card.id}`,card_id:card.id,name:card.nome,set_code:card.sigla,language:card.lingua,
  collector_number:number,denominator:m.set_total?String(m.set_total).replace(/^0+(?=\d)/,''):null,
  tags:[...new Set(tags)].sort(),facts,source_url:source.href,
  source_payload:{provider:'card-atlas',id:detail.id,localId:number,metadata_scope:'card-metadata-only',reference_image_only:true,metadata:m},
  verification:'source',image_url:null,label:'Dati della carta da catalogo ufficiale · finitura e stampini da verificare',
  search_text:normalizeSearch(`${card.nome} ${detail.name} ${card.sigla} ${card.codice||''}`),updated_at:new Date().toISOString()}
}

export async function enrichAtlasMetadata({db,root,log=console.log,limit=200,budgetMs=60000,loadSets=atlasSets,loadCards=atlasCards}){
 const deadline=Date.now()+budgetMs,stats={attempted:0,checked:0,indexed:0,errors:0}
 const cards=await check(db.from('cards').select('*').like('source_uid','atlas:%').is('traits_checked_at',null).lte('traits_next_attempt_at',new Date().toISOString()).order('id').limit(limit))
 if(!cards.length)return stats
 const sets=await loadSets(root),cache=new Map(),entries=[],checkedIds=[]
 for(const card of cards){
  if(Date.now()>deadline-5000)break
  stats.attempted++
  try{
   const candidates=sets.filter(s=>s.source_language===card.source_language&&normalizedSet(s.set_id)===normalizedSet(card.sigla))
   if(candidates.length!==1)throw Error('Set regionale mancante o ambiguo nell’archivio.')
   const set=candidates[0],key=`${set.source_language}:${set.set_id}`
   if(!cache.has(key))cache.set(key,await loadCards(root,set))
   const matches=cache.get(key).filter(d=>d.id===card.source_card_id)
   if(matches.length!==1)throw Error('Identificativo originale assente o duplicato nell’archivio.')
   entries.push(atlasMetadataEntry(card,matches[0],set));checkedIds.push(card.id)
  }catch(error){stats.errors++;await check(db.from('cards').update({traits_next_attempt_at:new Date(Date.now()+86400000).toISOString(),traits_last_error:String(error)}).eq('id',card.id));await log(`Metadati Atlas #${card.id}: ${String(error)}`)}
 }
 if(entries.length){
  const terms=termsForEntries(entries).map(t=>t.kind==='card-type'?{...t,aliases:[]}:t.kind==='regulation'?{...t,aliases:[`regolamento ${t.code.split(':')[1]}`,`regulation ${t.code.split(':')[1]}`]}:t)
  if(terms.length)await check(db.from('catalog_terms').upsert(terms,{onConflict:'code',ignoreDuplicates:true}))
  await check(db.from('catalog_search_entries').upsert(entries,{onConflict:'entry_key'}))
  await check(db.from('cards').update({traits_checked_at:new Date().toISOString(),traits_next_attempt_at:new Date(Date.now()+14*86400000).toISOString(),traits_last_error:null}).in('id',checkedIds))
  stats.checked=entries.length;stats.indexed=entries.length
  for(const entry of entries)await log(`Metadati Atlas #${entry.card_id} ${entry.name}: ${entry.tags.length} tag documentati; finitura e stampini sconosciuti.`)
 }
 return stats
}

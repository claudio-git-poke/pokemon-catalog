import {readFile} from 'node:fs/promises'
import {isDeepStrictEqual} from 'node:util'
import {normalizeSearch} from '../src/lib/catalog-identification.ts'
import {baseFacts} from './enrich-catalog.mjs'
import {termsForEntries} from './variant-mappings.mjs'
import {releaseCardIndex,resolveReleaseCard} from './release-card-links.mjs'
const number=x=>String(x||'').replace(/^0+(?=\d)/,'').toLowerCase()
export function uniqueDeckEntries(entries){
 const unique=new Map(),conflicts=new Set();let duplicates=0
 for(const entry of entries){const old=unique.get(entry.entry_key);if(!old)unique.set(entry.entry_key,entry);else if(isDeepStrictEqual(old,entry))duplicates++;else conflicts.add(entry.entry_key)}
 return {entries:[...unique.values()].filter(e=>!conflicts.has(e.entry_key)),duplicates,conflicts:[...conflicts]}
}
export function deckEntry(card,row){
 const numbered=row.deck_number!==null
 const family=row.family||'battle-academy',wcd=family==='world-championships'
 const facts=wcd?{extra_mark:true,printed_signature_visible:true,unusual_back:true,deck_number_visible:false,numbered_deck_marks:false}:{extra_mark:true,mark_bottom_right:true,mark_pokemon_like:true,numbered_deck_marks:numbered,deck_number_visible:numbered}
 const collector=row.local_id?number(row.local_id):null
 return {entry_key:`${row.release_code}:${row.deck}:${row.deck_number||'unnumbered'}:${card.id}`,card_id:card.id,release_code:row.release_code,release_year:row.year,collector_number:collector,denominator:row.printed_number?.includes('/')?row.printed_number.split('/')[1]:null,deck_code:row.deck,deck_number:row.deck_number,name:card.nome,set_code:card.sigla,language:card.lingua,tags:['family:'+family,'deck:'+row.deck,...(row.player?['stamp:'+normalizeSearch(row.player).replaceAll(' ','-')]:[])],facts:{...baseFacts(card),...facts},source_url:row.source,source_payload:{...row,printing_language:'en',reference_image_only:true},verification:'source',label:`${row.release_name} · ${row.deck}${row.player?' · '+row.player:''} · ${numbered?'posizione '+row.deck_number:'senza numero del mazzo'}`,search_text:normalizeSearch(`${card.nome} ${card.sigla} ${row.release_name} ${row.deck} ${row.year}`)}
}
export async function syncDeckMappings({db,log=console.log}){
 const rows=[...JSON.parse(await readFile(new URL('../data/catalog-decks.json',import.meta.url),'utf8')),...JSON.parse(await readFile(new URL('../data/catalog-world-decks.json',import.meta.url),'utf8'))],entries=[],issues=[],cards=await releaseCardIndex(db,rows)
 const check=async q=>{const{data,error}=await q;if(error)throw Error(error.message);return data}
 for(const row of rows){
  if(!row.set_id)continue // Base Energy printing is not identified by the deck guide.
  const result=resolveReleaseCard(row,cards)
  if(result.card)entries.push(deckEntry(result.card,row));else issues.push({release_code:row.release_code,deck:row.deck,deck_number:row.deck_number,set_id:row.set_id,local_id:row.local_id,name:row.name,reason:result.reason})
 }
 const consolidated=uniqueDeckEntries(entries),unique=consolidated.entries
 if(unique.length){const terms=termsForEntries(unique);await check(db.from('catalog_terms').upsert(terms,{onConflict:'code',ignoreDuplicates:true}));const releases=[...new Map(rows.map(r=>[r.release_code,{code:r.release_code,family_code:'family:'+r.family,name:r.release_name,release_year:r.year,source_url:r.source}])).values()];await check(db.from('catalog_releases').upsert(releases,{onConflict:'code',ignoreDuplicates:true}))}
 for(let i=0;i<unique.length;i+=100)await check(db.from('catalog_search_entries').upsert(unique.slice(i,i+100),{onConflict:'entry_key'}))
 await log(`Mazzi BA e WCD: ${unique.length}/${rows.length} mappature collegate; ${consolidated.duplicates} ripetizioni identiche consolidate; ${consolidated.conflicts.length} identità con dati discordanti sospese. Numeri del mazzo separati dai numeri collezione.`)
 return {indexed:unique.length,documented:rows.length,duplicates:consolidated.duplicates,conflicts:consolidated.conflicts.length,issues}
}

export async function linkMfbIdentities({db,log=console.log}){
 const manifest=JSON.parse(await readFile(new URL('../data/catalog-mfb-identities.json',import.meta.url),'utf8'))
 const {data:cards,error}=await db.from('cards').select('id,nome,source_card_id,source_language').in('sigla',['MFB','MFB@INT']).eq('lingua','INT').order('id');if(error)throw Error(error.message)
 let linked=0
 for(const row of manifest){
  const names=[row.name,...row.aliases].map(normalizeSearch),candidates=cards.filter(c=>names.includes(normalizeSearch(c.nome)))
  if(candidates.some(c=>c.source_card_id===row.id))continue
  const card=candidates.find(c=>!c.source_card_id);if(!card)continue
  const {error}=await db.from('cards').update({source_card_id:row.id,source_language:'en',traits_next_attempt_at:new Date().toISOString()}).eq('id',card.id).is('source_card_id',null);if(error)throw Error(error.message);linked++
 }
 await log(`MFB: ${linked} identità di base collegate. Le versioni della carta restano separate dalle immagini legacy.`)
 return linked
}

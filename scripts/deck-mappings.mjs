import {readFile} from 'node:fs/promises'
import {normalizeSearch} from '../src/lib/catalog-identification.ts'
import {baseFacts} from './enrich-catalog.mjs'
const number=x=>String(x||'').replace(/^0+(?=\d)/,'').toLowerCase()
export function deckEntry(card,row){
 const numbered=row.deck_number!==null
 const collector=row.local_id?number(row.local_id):null
 return {entry_key:`${row.release_code}:${row.deck}:${row.deck_number||'unnumbered'}:${card.id}`,card_id:card.id,release_code:row.release_code,release_year:row.year,collector_number:collector,denominator:row.printed_number?.includes('/')?row.printed_number.split('/')[1]:null,deck_code:row.deck,deck_number:row.deck_number,name:card.nome,set_code:card.sigla,language:card.lingua,tags:['family:battle-academy','deck:'+row.deck],facts:{...baseFacts(card),extra_mark:true,mark_bottom_right:true,mark_pokemon_like:true,numbered_deck_marks:numbered,deck_number_visible:numbered},source_url:row.source,source_payload:row,verification:'source',label:`${row.release_name} · ${row.deck} · ${numbered?'posizione '+row.deck_number:'senza numero del mazzo'}`,search_text:normalizeSearch(`${card.nome} ${card.sigla} ${row.release_name} ${row.deck} ${row.year}`)}
}
export async function syncDeckMappings({db,log=console.log}){
 const rows=JSON.parse(await readFile(new URL('../data/catalog-decks.json',import.meta.url),'utf8')),cache=new Map(),entries=[]
 const check=async q=>{const{data,error}=await q;if(error)throw Error(error.message);return data}
 for(const row of rows){
  if(!row.set_id)continue // Base Energy printing is not identified by the deck guide.
  if(!cache.has(row.set_id))cache.set(row.set_id,await check(db.from('cards').select('*').eq('lingua','INT').in('sigla',[row.set_id,row.set_id.toUpperCase(),row.set_id.toUpperCase()+'@INT']).limit(1000)))
  const candidates=cache.get(row.set_id).filter(c=>number(c.source_local_id||c.numero)===number(row.local_id)&&normalizeSearch(c.nome)===normalizeSearch(row.name)).sort((a,b)=>Number(!!b.source_uid)-Number(!!a.source_uid)||a.id-b.id)
  if(candidates.length)entries.push(deckEntry(candidates[0],row))
 }
 if(entries.length){const releases=[...new Map(rows.map(r=>[r.release_code,{code:r.release_code,family_code:'family:battle-academy',name:r.release_name,release_year:r.year,source_url:r.source}])).values()];await check(db.from('catalog_releases').upsert(releases,{onConflict:'code',ignoreDuplicates:true}))}
 for(let i=0;i<entries.length;i+=100)await check(db.from('catalog_search_entries').upsert(entries.slice(i,i+100),{onConflict:'entry_key'}))
 await log(`Mazzi BA: ${entries.length}/${rows.length} mappature collegate; numeri del mazzo separati dai numeri collezione.`)
 return {indexed:entries.length,documented:rows.length}
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

import {validatePublication,canonicalMarketPage,publicationPhoto} from './bindex-contract.mjs'
import {referenceTags,resolvePublication,stableKey} from './bindex-identity.mjs'
import {expandTags} from '../src/lib/catalog-identification.ts'
export const timestampMicros=value=>{const digits=(value.match(/\.(\d+)/)?.[1]||'').padEnd(6,'0');return BigInt(Date.parse(value))*1000n+BigInt(digits.slice(3,6))}
const check=async q=>{const{data,error}=await q;if(error)throw Error(error.message);return data}
let cache=null
async function references(db){
 if(cache)return cache
 const sets=await check(db.from('set_espansioni').select('*').order('sigla')),rows=[]
 for(let offset=0;;offset+=1000){const page=await check(db.from('set_carte').select('*').order('sigla').order('numero').order('variante').range(offset,offset+999));rows.push(...page);if(page.length<1000)break}
 cache={sets,rows};return cache
}
export async function publishBindex({db,log=console.log,limit=200}){
 const states=await check(db.from('catalog_export_state').select('*').eq('id','bindex').limit(1)),state=states[0]
 if(!state?.ready){await log('Esportazione Bindex: bootstrap non completato, nessuna pubblicazione automatica.');return {published:0,pending:0}}
 const {sets,rows}=await references(db)
 const queue=await check(db.rpc('catalog_export_queue',{after_time:state.cursor_time||'1970-01-01T00:00:00Z',after_key:state.cursor_key||'',batch_size:limit}))
 if(!queue.length)return {published:0,pending:0}
 const ids=[...new Set(queue.map(e=>e.card_id))],cards=await check(db.from('cards').select('id,nome,sigla,numero,variante,lingua,source_language,manual_overrides').in('id',ids)),byId=new Map(cards.map(c=>[c.id,c]))
 const links=await check(db.from('catalog_export_links').select('*').in('entry_key',queue.map(e=>e.entry_key))),byEntry=new Map(links.map(l=>[l.entry_key,l]))
 let published=0,pending=0,cursor=[state.cursor_time||'1970-01-01T00:00:00+00:00',state.cursor_key||'']
 await log(`Allineamento Bindex: verifico ${queue.length} stampe; le identità già pubblicate sono immutabili.`)
 for(const entry of queue){
  const link=byEntry.get(entry.entry_key),manualLink=link&&['sigla','numero','variante'].some(k=>Object.hasOwn(link.manual_overrides||{},k))
  const linkedRow=manualLink?rows.find(r=>stableKey(r)===stableKey(link)):null
  const result=manualLink?(linkedRow?{row:linkedRow,method:'manual_link'}:{reason:'manual_link_target_missing'}):resolvePublication(entry,byId.get(entry.card_id),sets,rows)
  if(result.reason){await check(db.from('catalog_export_pending').upsert({entry_key:entry.entry_key,reason:result.reason,detail:{source:entry.source_url},next_attempt_at:new Date(Date.now()+86400000).toISOString(),updated_at:new Date().toISOString()},{onConflict:'entry_key'}));pending++}
  else{
   const original=result.row,card=byId.get(entry.card_id)
   const update={...original,tag:expandTags([...(original.tag||referenceTags(original)),...entry.tags])}
   // A missing gold field may be filled; an existing identity or product assignment is never replaced.
   if(!update.rarita&&entry.source_payload?.rarity&&entry.source_payload.rarity!=='None')update.rarita=entry.source_payload.rarity
   if(!update.nome||entry.source_payload?.source_language==='it')update.nome=entry.source_payload?.source_name||update.nome||card?.nome
   if(Object.hasOwn(card?.manual_overrides||{},'nome'))update.nome=card.nome
   if(!update.cardmarket_id&&result.cm)update.cardmarket_id=result.cm
   update.cardmarket_url=canonicalMarketPage(update.cardmarket_url)
   const invalid=validatePublication(update)
   if(invalid){await check(db.from('catalog_export_pending').upsert({entry_key:entry.entry_key,reason:invalid,detail:{source:entry.source_url},next_attempt_at:new Date(Date.now()+86400000).toISOString(),updated_at:new Date().toISOString()},{onConflict:'entry_key'}));pending++;const t=timestampMicros(entry.updated_at),previous=timestampMicros(cursor[0]);if(t>previous||t===previous&&entry.entry_key>cursor[1])cursor=[entry.updated_at,entry.entry_key];continue}
   const photo=publicationPhoto(entry,card)
   delete update.immagine;delete update.immagine_hd;delete update.immagine_verificata
   delete update.aggiornato_il
   await check(db.from('set_carte').upsert(update,{onConflict:'sigla,numero,variante'}))
   const evidence={source:entry.source_url,source_card:entry.source_payload?.id||null}
   await check(db.from('catalog_export_links').upsert({entry_key:entry.entry_key,sigla:update.sigla,numero:update.numero,variante:update.variante,method:result.method,evidence},{onConflict:'entry_key'}))
   if(photo)await check(db.rpc('bindex_publish_photo',{set_code:update.sigla,card_number:update.numero,printing:update.variante,...photo}))
   await check(db.from('catalog_export_pending').delete().eq('entry_key',entry.entry_key))
   const index=rows.findIndex(r=>stableKey(r)===stableKey(update));if(index>=0)rows[index]=update;else rows.push(update)
   published++
  }
  const t=timestampMicros(entry.updated_at),previous=timestampMicros(cursor[0]);if(t>previous||t===previous&&entry.entry_key>cursor[1])cursor=[entry.updated_at,entry.entry_key]
 }
 await check(db.rpc('catalog_export_progress',{cursor_time_new:cursor[0],cursor_key_new:cursor[1],counts:{published,pending,examined:queue.length}}))
 await log(`Allineamento Bindex: ${published} stampe collegate/pubblicate, ${pending} sospese per identità non certa.`)
 return {published,pending}
}

import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {fetchMetadataPage} from './tcgdex-metadata-pages.mjs'
import {retryRarityRpc} from './rarity-evidence.mjs'
export const METADATA_VERSION='fields-v1-p2000:'+createHash('sha256').update(readFileSync(new URL('../data/catalog-rarity-aliases.json',import.meta.url))).update(readFileSync(new URL('../data/catalog-metadata-aliases.json',import.meta.url))).digest('hex').slice(0,16)
const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
export async function backfillCardMetadata({db,log=console.log,deadline=Date.now()+35*60000,clock=Date.now,fetchPage=fetchMetadataPage,languages,version=METADATA_VERSION}){
 const stats={languages:{},updated:0,matched:0,deferred:0}
 const available=languages||await retryRarityRpc(db,'catalog_card_metadata_languages',{})
 const states=await check(db.from('catalog_metadata_backfill_state').select('*'))
 const byLanguage=new Map(states.map(s=>[s.source_language,s])),priority=['it','en','de','es','pt','fr','ja','es-mx','id','th','zh-cn','zh-tw','ko']
 const ordered=available.map(x=>typeof x==='string'?x:x.source_language).sort((a,b)=>{
  const aPending=byLanguage.get(a)?.next_page>1,bPending=byLanguage.get(b)?.next_page>1
  return Number(bPending)-Number(aPending)||priority.indexOf(a)-priority.indexOf(b)
 })
 const timeLeft=()=>clock()<deadline-65000
 for(const language of ordered){
  if(!timeLeft()){stats.deferred++;break}
  const saved=byLanguage.get(language),same=saved?.mapping_version===version
  if(same&&saved.completed_at&&clock()-Date.parse(saved.completed_at)<30*60000){stats.languages[language]={skipped:'recently-completed'};continue}
  let page=same?saved.next_page:1
  const current=stats.languages[language]={start_page:page,next_page:page,matched:0,updated:0,complete:false}
  try{
   while(timeLeft()){
    // Fetch two pages concurrently; acknowledge them strictly in order after publishing every batch.
    const window=await Promise.allSettled([fetchPage(language,page,2000),fetchPage(language,page+1,2000)])
    for(const result of window){
     if(result.status==='rejected')throw result.reason
     const rows=result.value
     let deferred=0
     for(let offset=0;offset<rows.length;offset+=200){
      const r=await retryRarityRpc(db,'catalog_apply_card_metadata',{items:rows.slice(offset,offset+200)})
      current.updated+=r.updated;current.matched+=r.matched;stats.updated+=r.updated;stats.matched+=r.matched;deferred+=r.deferred
     }
     if(deferred){stats.deferred+=deferred;throw Error('Righe bloccate: la pagina sarà ripetuta')}
     const complete=rows.length<2000,next_page=complete?1:page+1
     await check(db.from('catalog_metadata_backfill_state').upsert({source_language:language,next_page,mapping_version:version,
      completed_at:complete?new Date(clock()).toISOString():null,updated_at:new Date(clock()).toISOString()},{onConflict:'source_language'}))
     current.next_page=next_page;current.complete=complete
     await log(`Metadati ${language}: pagina ${page}, ${current.matched} carte presenti, ${current.updated} righe aggiornate${complete?' · lingua completata':''}.`)
     page++
     if(complete)break
    }
    if(current.complete)break
   }
   if(!current.complete)stats.deferred++
  }catch(error){stats.deferred++;current.error=String(error);await log(`Metadati ${language}: ripresa dalla pagina ${current.next_page} (${String(error)}).`)}
 }
 return stats
}

// Keep the existing same-identity Atlas/other stored-evidence rarity maintenance,
// with its own bookmark so it cannot starve later TCGdex languages.
export async function backfillStoredRarities({db,log=console.log,deadline=Date.now()+90000}){
 const key='_stored_rarity',state=await check(db.from('catalog_metadata_backfill_state').select('*').eq('source_language',key).maybeSingle())
 let cursor=state?.after_card_id||0
 const result={updated:0,deferred:0,complete:false}
 while(Date.now()<deadline-5000){
  const r=await retryRarityRpc(db,'catalog_backfill_generic_rarity',{after_id:cursor,batch_size:500})
  result.updated+=r.updated
  if(r.deferred){result.deferred+=r.deferred;break}
  result.complete=!r.next_id;cursor=r.next_id||0
  await check(db.from('catalog_metadata_backfill_state').upsert({source_language:key,next_page:1,after_card_id:cursor,mapping_version:'stored-rarity-v1',completed_at:result.complete?new Date().toISOString():null,updated_at:new Date().toISOString()},{onConflict:'source_language'}))
  if(result.complete)break
 }
 if(!result.complete)result.deferred++
 await log(`Rarità da evidenza già conservata: ${result.updated} righe completate; cursore ${cursor}${result.complete?' · passaggio completo':''}.`)
 return result
}

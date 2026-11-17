import {createClient} from '@supabase/supabase-js'
import {createCatalogLogger} from './catalog-logger.mjs'
import {RARITY_LANGUAGES,collectRarityEvidence,retryRarityRpc} from './rarity-evidence.mjs'
import {databaseError,isTransientDatabaseError} from './database-errors.mjs'
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const check=async q=>{const{data,error}=await q;if(error)throw databaseError(error);return data}
const run=await check(db.from('catalog_sync_runs').insert({}).select('id').single())
const summary={task:'card-metadata-repair',canonicalized:0,restored:0,deferred:0,languages:{}}
const log=createCatalogLogger({db,runId:run.id,summary}),deadline=Date.now()+18*60000
const timeLeft=()=>Date.now()<deadline-30000
try{
 let key=''
 while(timeLeft()){
  const r=await retryRarityRpc(db,'catalog_repair_rarity_tags',{after_key:key,batch_size:250})
  summary.canonicalized+=r.updated;summary.deferred+=r.deferred||0
  if(!r.next_key)break
  key=r.next_key
  await log(`Tag delle stampe normalizzati: ${summary.canonicalized}.`)
 }
 if(!timeLeft())summary.deferred++
 for(const language of RARITY_LANGUAGES){
  if(!timeLeft()){summary.deferred++;break}
  let evidence
  try{evidence=await collectRarityEvidence({language,log})}
  catch(error){summary.deferred++;await log(`Indice delle rarità ${language}: rinviato (${String(error)}).`);continue}
  const stats=summary.languages[language]={groups:evidence.groups,evidence:evidence.rows.length,conflicts:evidence.conflicts.length,errors:evidence.errors.length,updated:0,matched:0}
  summary.deferred+=stats.conflicts+stats.errors
  for(let offset=0;offset<evidence.rows.length;offset+=200){
   if(!timeLeft()){summary.deferred++;break}
   const r=await retryRarityRpc(db,'catalog_apply_rarity_evidence',{items:evidence.rows.slice(offset,offset+200)})
   stats.updated+=r.updated;stats.matched+=r.matched;summary.deferred+=r.deferred
  }
  await log(`Rarità ${language}: ${stats.matched} carte presenti, ${stats.updated} righe aggiornate da elenchi documentati.`)
 }
 let cursor=0
 while(timeLeft()){
  const r=await retryRarityRpc(db,'catalog_backfill_generic_rarity',{after_id:cursor,batch_size:250})
  summary.restored+=r.updated;summary.deferred+=r.deferred||0
  if(!r.next_id)break
  cursor=r.next_id
  await log(`Rarità documentate ripristinate sulle righe generiche: ${summary.restored}.`)
 }
 if(!timeLeft())summary.deferred++
 const assets=await check(db.from('catalog_visual_assets').select('asset_key,tag_codes,manual_overrides').eq('kind','rarity').eq('source_code','shiny-ultra-rare').eq('match_mode','tag'))
 for(const asset of assets)if(!Object.hasOwn(asset.manual_overrides||{},'tag_codes')&&!asset.tag_codes.includes('rarity:shiny-ultra-rare')){
  await check(db.from('catalog_visual_assets').update({tag_codes:[...asset.tag_codes,'rarity:shiny-ultra-rare']}).eq('asset_key',asset.asset_key))
 }
 await log(`Recupero concluso: ${summary.canonicalized} stampe normalizzate, ${summary.restored} righe generiche ripristinate; ${summary.deferred} rinvii.`,true)
 await check(db.from('catalog_sync_runs').update({status:summary.deferred?'partial':'success',finished_at:new Date().toISOString(),summary}).eq('id',run.id))
}catch(error){
 const transient=isTransientDatabaseError(error)
 await check(db.from('catalog_sync_runs').update({status:transient?'partial':'error',finished_at:new Date().toISOString(),summary:{...summary,error:String(error)}}).eq('id',run.id))
 if(!transient)throw error
 console.log('Riparazione rinviata per un errore temporaneo del database: '+String(error))
}

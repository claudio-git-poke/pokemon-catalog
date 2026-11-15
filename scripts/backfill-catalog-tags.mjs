import {readTagBacklog} from './tag-backlog.mjs'
import {createClient} from '@supabase/supabase-js'
import {enrichCatalog} from './enrich-catalog.mjs'
import {createCatalogLogger} from './catalog-logger.mjs'

const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!secret)throw Error('Configurare URL Supabase e SERVICE_ROLE_KEY nei secrets del worker.')
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
const run=await check(db.from('catalog_sync_runs').insert({}).select('id').single())
const summary={task:'tag-backfill',attempted:0,checked:0,indexed:0,errors:0}
const log=createCatalogLogger({db,runId:run.id,summary})

try{
 const deadline=Date.now()+40*60000
 const backlog=await readTagBacklog({db})
 summary.initial_pending=backlog.count;summary.initial_pending_at=backlog.at
 if(backlog.error)await log(`Conteggio iniziale non disponibile: ${backlog.error}. Continuo dalla coda delle carte senza ripetere il conteggio.`,true)
 await log(`Recupero tag retroattivo: ${backlog.count==null?'totale iniziale non disponibile':backlog.count+' carte TCGdex mai esaminate all’avvio'}. Nessun tag visivo viene dedotto dalle immagini generiche.`,true)
 while(Date.now()<deadline-90000){
  const keys=['attempted','checked','indexed','errors'],before={...summary}
  const progress=stats=>{for(const key of keys)summary[key]=before[key]+stats[key]}
  const stats=await enrichCatalog({db,log,onlyUnchecked:true,limit:200,budgetMs:60000,concurrency:1,onProgress:progress})
  progress(stats)
  if(stats.databaseUnavailable){
   summary.deferred=true
   await log('Database temporaneamente occupato: lotto sospeso. Riprenderò dalle carte ancora in attesa al prossimo avvio.',true)
   break
  }
  await log(`Recupero tag: ${summary.checked} carte controllate, ${summary.indexed} stampe indicizzate; ${summary.errors} errori rinviati.`,true)
  if(stats.sourceUnavailable){await log('Fonte temporaneamente indisponibile o limite richieste raggiunto: sospendo il recupero fino al prossimo avvio.',true);break}
  if(!stats.attempted)break
 }
 await log(`Recupero tag concluso per questa sessione. ${summary.checked} carte controllate e ${summary.indexed} stampe indicizzate. Il totale residuo non viene ricalcolato a ogni lotto. Ripresa automatica dal prossimo lotto.`,true)
 await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:summary.errors?'partial':'success',summary:{...summary,log_version:2,current:'Recupero tag retroattivo concluso'}}).eq('id',run.id))
}catch(error){
 await log(`Recupero tag interrotto: ${String(error)}`,true)
 await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:'error',summary:{...summary,error:String(error)}}).eq('id',run.id))
 throw error
}

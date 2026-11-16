import {createClient} from '@supabase/supabase-js'
import {runCoverageAudit} from './coverage-audit.mjs'
import {createCatalogLogger} from './catalog-logger.mjs'
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!secret)throw Error('Configurare i secrets Supabase del worker.')
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
const check=async q=>{const{data,error}=await q;if(error)throw Error(error.message);return data}
const run=await check(db.from('catalog_sync_runs').insert({}).select('id').single())
const summary={task:'coverage-audit'}
const log=createCatalogLogger({db,runId:run.id,summary})
try{
 const result=await runCoverageAudit({db,log,onProgress:stats=>Object.assign(summary,stats)})
 Object.assign(summary,result)
 await log(result.complete?'Copertura: nuova rilevazione pubblicata.':result.skipped?'Copertura: rilevazione recente, nessun lavoro aggiuntivo.':'Copertura: avanzamento salvato, lavoro da riprendere.',true)
 await check(db.from('catalog_sync_runs').update({status:result.deferred?'partial':'success',finished_at:new Date().toISOString(),summary:{...summary,log_version:2,current:result.complete?'Rilevazione copertura completata':result.skipped?'Rilevazione recente: nessuna nuova scansione':'Copertura: ripresa dal checkpoint alla prossima esecuzione'}}).eq('id',run.id))
}catch(error){await log('Controllo copertura interrotto: '+String(error),true);await check(db.from('catalog_sync_runs').update({status:'error',finished_at:new Date().toISOString(),summary:{...summary,error:String(error)}}).eq('id',run.id));throw error}

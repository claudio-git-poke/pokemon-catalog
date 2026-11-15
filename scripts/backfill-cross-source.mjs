import {createClient} from '@supabase/supabase-js'
import {createCatalogLogger} from './catalog-logger.mjs'
import {runCrossSourceSession} from './cross-source-session.mjs'
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!secret)throw Error('Configurare URL Supabase e SERVICE_ROLE_KEY nei secrets del worker.')
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
const check=async query=>{const {data,error}=await query;if(error)throw Error(error.message);return data}
const run=await check(db.from('catalog_sync_runs').insert({}).select('id').single())
const summary={task:'source-comparison',checked:0,concordant:0,differences:0,uncomparable:0,errors:0}
const log=createCatalogLogger({db,runId:run.id,summary})
try{
 await log(`Confronto fonti indipendente dall’importazione; massimo 60 coppie e 12 minuti. Versione ${process.env.GITHUB_SHA||'locale'}. Le varianti e l’indipendenza dei dati originali restano da verificare.`,true)
 await runCrossSourceSession({db,log,onProgress:stats=>Object.assign(summary,stats)})
 await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:summary.errors?'partial':'success',summary:{...summary,log_version:2,current:'Sessione confronto fonti conclusa'}}).eq('id',run.id))
}catch(error){
 await log('Confronto fonti interrotto: '+String(error),true)
 await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:'error',summary:{...summary,error:String(error)}}).eq('id',run.id))
 throw error
}

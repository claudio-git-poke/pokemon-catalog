import {createClient} from '@supabase/supabase-js'
import {runInventorySession} from './printing-inventory.mjs'
import {createCatalogLogger} from './catalog-logger.mjs'
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!secret)throw Error('Configurare URL Supabase e SERVICE_ROLE_KEY nei secrets del worker.')
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
const check=async query=>{const {data,error}=await query;if(error)throw Error(error.message||error.code||'Errore database');return data}
const run=await check(db.from('catalog_sync_runs').insert({}).select('id').single())
const summary={task:'printing-inventory',processed:0,printings:0,cardOnly:0,missingImages:0}
const log=createCatalogLogger({db,runId:run.id,summary})
try{
 await log('Inventario Bindex: raccolgo solo versioni e lingue documentate. Le immagini generiche restano riferimenti; nessuna combinazione lingua × variante viene inventata.',true)
 await runInventorySession({db,log,onProgress:stats=>Object.assign(summary,stats)})
 await log(`Inventario Bindex: sessione conclusa, ${summary.processed} dichiarazioni elaborate. I totali delle fonti non sono il numero delle carte fisiche uniche.`,true)
 await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:summary.deferred?'partial':'success',summary:{...summary,log_version:2,current:summary.deferred?'Inventario parziale: lavoro rinviato conservato in coda':'Inventario aggiornato per questa sessione'}}).eq('id',run.id))
}catch(error){
 await log('Inventario Bindex interrotto: '+String(error),true)
 await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:'error',summary:{...summary,error:String(error)}}).eq('id',run.id))
 throw error
}

import {createClient} from '@supabase/supabase-js'
import {runSourceManifestAudit} from './source-manifest-audit.mjs'
import {createCatalogLogger} from './catalog-logger.mjs'
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!key)throw Error('Configurare i secrets Supabase del catalogo')
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const check=async q=>{const{data,error}=await q;if(error)throw Error(error.message);return data}
const run=await check(db.from('catalog_sync_runs').insert({}).select('id').single())
const summary={task:'source-manifest-audit'},log=createCatalogLogger({db,runId:run.id,summary})
try{
 await log('Confronto degli elenchi: sola lettura delle carte; le correzioni manuali restano definitive.',true)
 Object.assign(summary,await runSourceManifestAudit({db,root:process.env.ATLAS_DATA_DIR,log,onProgress:s=>Object.assign(summary,s)}))
 await log(`Elenchi controllati: ${summary.checked_lists}; identificativi senza collegamento esatto: ${summary.missing_links}. Carte fisiche mancanti ancora da verificare.`,true)
 await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:summary.errors||summary.deferred?'partial':'success',summary}).eq('id',run.id))
}catch(error){await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:'error',summary:{...summary,error:String(error)}}).eq('id',run.id));throw error}

import {createClient} from '@supabase/supabase-js'
import {runSupplemental} from './supplemental-sources.mjs'
import {createCatalogLogger} from './catalog-logger.mjs'
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!key)throw Error('Configurare i secrets del catalogo')
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
const run=await check(db.from('catalog_sync_runs').insert({}).select('id').single())
const summary={task:'supplemental-sources'},log=createCatalogLogger({db,runId:run.id,summary})
try{
 await log('Fonti aggiuntive: inglese PkmnCards via Atlas, cataloghi ufficiali thailandese e indonesiano. Foto di riferimento; varianti non dedotte.',true)
 Object.assign(summary,await runSupplemental({db,root:process.env.ATLAS_DATA_DIR,log}))
 await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:summary.errors||summary.deferred?'partial':'success',summary}).eq('id',run.id))
}catch(error){await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:'error',summary:{...summary,error:String(error)}}).eq('id',run.id));throw error}

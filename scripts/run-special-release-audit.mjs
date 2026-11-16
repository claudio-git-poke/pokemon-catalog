import {createClient} from '@supabase/supabase-js'
import {auditSpecialReleases} from './special-release-audit.mjs'
import {createCatalogLogger} from './catalog-logger.mjs'
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!key)throw Error('Configurare i secrets del catalogo')
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
const run=await check(db.from('catalog_sync_runs').insert({}).select('id').single()),summary={task:'special-release-audit'},log=createCatalogLogger({db,runId:run.id,summary})
try{
 const r=await auditSpecialReleases({db,log})
 Object.assign(summary,{releases:r.releases.length,published:r.published_now,unlinked:r.releases.reduce((n,x)=>n+(x.source_unlinked||0),0)})
 await log(`Uscite speciali: ${summary.releases} elenchi controllati; ${summary.published} nuovi collegamenti canonici; ${summary.unlinked} identità di fonte ancora da risolvere.`,true)
 await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:'success',summary}).eq('id',run.id))
}catch(error){await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:'error',summary:{...summary,error:String(error)}}).eq('id',run.id));throw error}

import {createClient} from '@supabase/supabase-js'
import {createCatalogLogger} from './catalog-logger.mjs'
import {backfillCardMetadata,backfillStoredRarities} from './metadata-backfill.mjs'
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const check=async q=>{const{data,error}=await q;if(error)throw Error(error.message);return data}
const run=await check(db.from('catalog_sync_runs').insert({}).select('id').single()),summary={task:'card-metadata-repair',version:2}
const log=createCatalogLogger({db,runId:run.id,summary})
try{
 const deadline=Date.now()+35*60000
 const result=await backfillCardMetadata({db,log,deadline})
 result.stored_rarity=await backfillStoredRarities({db,log,deadline:Math.min(deadline,Date.now()+90000)})
 result.deferred+=result.stored_rarity.deferred
 Object.assign(summary,result)
 await log(`Metadati conclusi: ${result.updated} righe aggiornate; ${result.deferred} rinvii. Le pagine non completate riprenderanno dal punto salvato.`,true)
 await check(db.from('catalog_sync_runs').update({status:result.deferred?'partial':'success',finished_at:new Date().toISOString(),summary}).eq('id',run.id))
}catch(error){await check(db.from('catalog_sync_runs').update({status:'error',finished_at:new Date().toISOString(),summary:{...summary,error:String(error)}}).eq('id',run.id));throw error}

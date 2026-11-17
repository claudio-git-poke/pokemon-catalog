import {createClient} from '@supabase/supabase-js'
import {enrichCatalog} from './enrich-catalog.mjs'
import {createCatalogLogger} from './catalog-logger.mjs'
import {reportedMetadataCards} from './card-metadata.mjs'
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const check=async q=>{const{data,error}=await q;if(error)throw Error(error.message);return data}
const run=await check(db.from('catalog_sync_runs').insert({}).select('id').single()),summary={task:'card-metadata-repair',restored:0}
const log=createCatalogLogger({db,runId:run.id,summary}),deadline=Date.now()+15*60000
try{
 let cursor=0
 while(Date.now()<deadline-180000){
  const result=await check(db.rpc('catalog_backfill_generic_rarity',{after_id:cursor,batch_size:250}))
  summary.restored+=result.updated
  if(!result.next_id)break
  cursor=result.next_id
  await log(`Rarità documentate ripristinate sulle righe generiche: ${summary.restored}.`)
 }
 // The reported regression has a bounded priority pass; the general tag worker continues the full backlog.
 const priority=await reportedMetadataCards(db)
 summary.priority=priority.length?await enrichCatalog({db,log,cardRows:priority,limit:600,budgetMs:180000,concurrency:3}):null
 await log(`Recupero metadati concluso: ${summary.restored} rarità già documentate ripristinate.`,true)
 await check(db.from('catalog_sync_runs').update({status:summary.priority?.errors?'partial':'success',finished_at:new Date().toISOString(),summary}).eq('id',run.id))
}catch(error){await check(db.from('catalog_sync_runs').update({status:'error',finished_at:new Date().toISOString(),summary:{...summary,error:String(error)}}).eq('id',run.id));throw error}

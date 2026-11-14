import {createClient} from '@supabase/supabase-js'
import {enrichAtlasMetadata} from './atlas-metadata.mjs'
import {createCatalogLogger} from './catalog-logger.mjs'
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY,root=process.env.ATLAS_DATA_DIR
if(!url||!secret||!root)throw Error('Configurare Supabase e ATLAS_DATA_DIR per il recupero dei metadati Atlas.')
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
const run=await check(db.from('catalog_sync_runs').insert({}).select('id').single())
const summary={task:'atlas-tag-backfill',attempted:0,checked:0,indexed:0,errors:0,remaining:0}
const log=createCatalogLogger({db,runId:run.id,summary})
async function remaining(){const {count,error}=await db.from('cards').select('id',{count:'exact',head:true}).like('source_uid','atlas:%').is('traits_checked_at',null);if(error)throw Error(error.message);return count}
try{
 const deadline=Date.now()+40*60000
 summary.remaining=await remaining()
 await log(`Recupero metadati Atlas: ${summary.remaining} carte regionali da controllare; nessuna deduzione di holo o stampini.`,true)
 while(Date.now()<deadline-70000){
  const stats=await enrichAtlasMetadata({db,root,log,limit:200,budgetMs:60000})
  for(const k of ['attempted','checked','indexed','errors'])summary[k]+=stats[k]
  summary.remaining=await remaining()
  await log(`Metadati Atlas: ${summary.checked} carte controllate, ${summary.remaining} in attesa, ${summary.errors} problemi rinviati.`,true)
  if(!stats.attempted)break
 }
 await log('Recupero metadati Atlas concluso per questa sessione. Avanzamento salvato.',true)
 await check(db.from('catalog_sync_runs').update({status:summary.errors?'partial':'success',finished_at:new Date().toISOString(),summary:{...summary,log_version:2,current:'Recupero metadati Atlas concluso'}}).eq('id',run.id))
}catch(error){
 await log(`Recupero metadati Atlas interrotto: ${String(error)}`,true)
 await check(db.from('catalog_sync_runs').update({status:'error',finished_at:new Date().toISOString(),summary:{...summary,error:String(error)}}).eq('id',run.id))
 throw error
}

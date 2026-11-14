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
const count=async()=>{
 const {count,error}=await db.from('cards').select('id',{count:'exact',head:true}).like('source_uid','tcgdex:%').is('traits_checked_at',null)
 if(error)throw Error(error.message);return count
}
try{
 const deadline=Date.now()+40*60000
 summary.remaining=await count()
 await log(`Recupero tag retroattivo: ${summary.remaining} carte TCGdex mai esaminate. Nessun tag visivo viene dedotto dalle immagini generiche.`,true)
 while(Date.now()<deadline-90000){
  const stats=await enrichCatalog({db,log,onlyUnchecked:true,limit:200,budgetMs:60000})
  for(const key of ['attempted','checked','indexed','errors'])summary[key]+=stats[key]
  summary.remaining=await count()
  await log(`Recupero tag: ${summary.checked} carte controllate, ${summary.indexed} stampe indicizzate, ${summary.remaining} carte ancora da controllare; ${summary.errors} errori rinviati.`,true)
  if(!stats.attempted)break
 }
 await log(`Recupero tag concluso per questa sessione. Restanti: ${summary.remaining}. Ripresa automatica dal prossimo lotto.`,true)
 await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:summary.errors?'partial':'success',summary:{...summary,log_version:2,current:'Recupero tag retroattivo concluso'}}).eq('id',run.id))
}catch(error){
 await log(`Recupero tag interrotto: ${String(error)}`,true)
 await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:'error',summary:{...summary,error:String(error)}}).eq('id',run.id))
 throw error
}

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
 const minutes=Number(process.env.SUPPLEMENTAL_MINUTES||8)
 if(!Number.isFinite(minutes)||minutes<1||minutes>240)throw Error('SUPPLEMENTAL_MINUTES deve essere tra 1 e 240.')
 // One pass handles at most 20 pages per language; keep going until the time
 // budget ends or no page is due any more (a pass with no completed page).
 const end=Date.now()+minutes*60000,total={added:0,changed:0,pages:0,errors:0}
 let deferred=false
 for(let pass=1;pass<=200&&end-Date.now()>2*60000;pass++){
  const result=await runSupplemental({db,root:process.env.ATLAS_DATA_DIR,log,budgetMs:end-Date.now()})
  for(const key of ['added','changed','pages','errors'])total[key]+=result[key]
  deferred=Boolean(result.deferred)
  if(deferred||result.pages===0)break
  await log(`Fonti aggiuntive: passata ${pass} conclusa, ${total.pages} pagine, ${total.added} nuove evidenze in totale; continuo.`,true)
 }
 Object.assign(summary,{...total,deferred})
 await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:summary.errors||summary.deferred?'partial':'success',summary}).eq('id',run.id))
}catch(error){await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:'error',summary:{...summary,error:String(error)}}).eq('id',run.id));throw error}

import {createClient} from '@supabase/supabase-js'
import {runResearch} from './research-sources.mjs'
import {createCatalogLogger} from './catalog-logger.mjs'
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!key)throw Error('Configurare i secrets del catalogo')
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
const run=await check(db.from('catalog_sync_runs').insert({}).select('id').single())
const summary={task:'research-sources'},log=createCatalogLogger({db,runId:run.id,summary})
try{
 await log('Fonti promo e varianti: Pokumon, Bulbapedia e Limitless. Placeholder esclusi; foto di riferimento e indizi separati dalle versioni confermate.',true)
 Object.assign(summary,await runResearch({db,log}))
 await log(`Fonti promo: sessione conclusa, ${summary.added} nuove evidenze, ${summary.changed} cambiate, ${summary.errors} errori; ${summary.deferred?'lavoro restante conservato in coda':'lotti selezionati elaborati'}.`,true)
 Object.assign(summary,{log_version:2,current:'Sessione fonti promo conclusa; copertura globale non certificata',updated_at:new Date().toISOString()})
 await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:summary.errors||summary.deferred?'partial':'success',summary}).eq('id',run.id))
}catch(error){await check(db.from('catalog_sync_runs').update({finished_at:new Date().toISOString(),status:'error',summary:{...summary,error:String(error)}}).eq('id',run.id));throw error}

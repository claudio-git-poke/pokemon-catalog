import { randomUUID } from 'node:crypto'
export function createCatalogLogger({db,runId,summary,clock=Date.now,output=console.log}) {
 summary.logger_version=3
 let buffer=[],lastFlush=0,flushing=Promise.resolve()
 async function check(query){const {error}=await query;if(error)throw Error(error.message)}
 return async function log(message,force=false){
  const at=new Date(clock()).toISOString()
  buffer.push({run_id:runId,at,message,event_key:randomUUID()})
  output(`[${at}] ${message}`)
  if(force || clock()-lastFlush>=1000 || buffer.length>=50){
   // Detach synchronously: concurrent workers must never insert the same batch twice.
   const batch=buffer
   buffer=[]
   lastFlush=clock()
   const snapshot={...summary,log_version:2,current:message,updated_at:at}
   flushing=flushing.then(async()=>{
    await check(db.from('catalog_sync_events').upsert(batch,{onConflict:'run_id,event_key',ignoreDuplicates:true}))
    await check(db.from('catalog_sync_runs').update({summary:snapshot}).eq('id',runId))
   })
   await flushing
  }
 }
}

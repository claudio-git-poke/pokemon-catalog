import { randomUUID } from 'node:crypto'
export function createCatalogLogger({db,runId,summary,clock=Date.now,output=console.log}) {
 let buffer=[],lastFlush=0
 async function check(query){const {error}=await query;if(error)throw Error(error.message)}
 return async function log(message,force=false){
  const at=new Date(clock()).toISOString()
  buffer.push({run_id:runId,at,message,event_key:randomUUID()})
  output(`[${at}] ${message}`)
  if(force || clock()-lastFlush>=1000 || buffer.length>=50){
   await check(db.from('catalog_sync_events').insert(buffer))
   buffer=[]
   await check(db.from('catalog_sync_runs').update({summary:{...summary,log_version:2,current:message,updated_at:at}}).eq('id',runId))
   lastFlush=clock()
  }
 }
}

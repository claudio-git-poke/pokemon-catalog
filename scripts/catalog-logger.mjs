import {databaseError,isTransientDatabaseError} from './database-errors.mjs'
import { randomUUID } from 'node:crypto'
export function createCatalogLogger({db,runId,summary,clock=Date.now,output=console.log,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
 summary.logger_version=3
 let buffer=[],lastFlush=0,flushing=Promise.resolve(),pending=[]
 async function check(operation){
  for(let attempt=0;;attempt++){
   let error
   try{({error}=await operation())}catch(cause){error=cause}
   if(!error)return
   const failure=databaseError(error)
   if(attempt>=1||!isTransientDatabaseError(failure))throw failure
   output(`[${new Date(clock()).toISOString()}] Log: salvataggio temporaneamente non disponibile; riprovo una volta tra 1,5 secondi.`)
   await wait(1500)
  }
 }
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
   pending.push({batch,snapshot})
   // A failed flush remains queued. A later call retries it with the SAME keys,
   // including when events committed but the summary response was lost.
   flushing=flushing.catch(()=>{}).then(async()=>{
    while(pending.length){
     const task=pending[0]
     await check(()=>db.from('catalog_sync_events').upsert(task.batch,{onConflict:'run_id,event_key',ignoreDuplicates:true}))
     await check(()=>db.from('catalog_sync_runs').update({summary:task.snapshot}).eq('id',runId))
     pending.shift()
    }
   })
   await flushing
  }
 }
}

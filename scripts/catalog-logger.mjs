import {databaseError,isTransientDatabaseError} from './database-errors.mjs'
// Log v4: every message goes only to the process output (GitHub Actions keeps
// the full log). The database receives just the small run summary, at most
// once every `summaryEveryMs`. Storing each event filled the free database
// quota (1.1 million rows, 332 MB) and multiplied the writes of every session.
export function createCatalogLogger({db,runId,summary,clock=Date.now,output=console.log,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),summaryEveryMs=30000}) {
 summary.logger_version=4
 let lastFlush=0,flushing=Promise.resolve(),pending=null
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
  output(`[${at}] ${message}`)
  if(!force&&clock()-lastFlush<summaryEveryMs)return
  lastFlush=clock()
  // Only the latest summary matters: a newer snapshot replaces one still waiting.
  pending={...summary,log_version:3,current:message,updated_at:at}
  flushing=flushing.catch(()=>{}).then(async()=>{
   while(pending){
    const snapshot=pending
    await check(()=>db.from('catalog_sync_runs').update({summary:snapshot}).eq('id',runId))
    if(pending===snapshot)pending=null
   }
  })
  await flushing
 }
}

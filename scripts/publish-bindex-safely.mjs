import {publishBindex} from './publish-bindex.mjs'
export async function publishBindexSafely({db,publish=publishBindex,log=console.error}){
 try{return {...await publish({db}),errors:0}}
 catch(error){
  const message=`Pubblicazione Bindex rinviata: ${String(error)}. Importazioni e immagini continuano; il lotto sarà riprovato senza avanzare il cursore.`
  log(message)
  const {error:saveError}=await db.from('catalog_sync_runs').insert({finished_at:new Date().toISOString(),status:'partial',summary:{task:'bindex-publish',current:message,error:String(error),errors:1,log_version:2,updated_at:new Date().toISOString()}})
  if(saveError)log(`Impossibile registrare il rinvio: ${saveError.message}`)
  return {published:0,pending:0,errors:1}
 }
}

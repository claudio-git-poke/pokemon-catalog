// Informational snapshot only: processing uses the bounded due-card queue.
export async function readTagBacklog({db,clock=Date.now}){
 try{
  const {count,error}=await db.from('cards').select('id',{count:'exact',head:true}).like('source_uid','tcgdex:%').is('traits_checked_at',null)
  if(error)throw Error(error.message||error.details||error.code||'Risposta senza dettaglio dal conteggio')
  if(!Number.isInteger(count)||count<0)throw Error('Conteggio non disponibile nella risposta')
  return {count,at:new Date(clock()).toISOString(),error:null}
 }catch(error){return {count:null,at:null,error:error?.message||String(error)}}
}

export async function refreshQualityCache({db,log=console.log}){
 const {error}=await db.rpc('catalog_refresh_quality_cache')
 if(error){await log(`Riepilogo Copertura: aggiornamento rimandato: ${error.message}`);return {errors:1}}
 await log('Aggiornamento Copertura richiesto: il controllo a lotti salva il riepilogo in background; le pagine leggono l’ultima rilevazione completata.');return {errors:0}
}

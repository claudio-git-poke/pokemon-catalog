export async function refreshQualityCache({db,log=console.log}){
 const {error}=await db.rpc('catalog_refresh_quality_cache')
 if(error){await log(`Riepilogo Copertura: aggiornamento rimandato: ${error.message}`);return {errors:1}}
 await log('Riepilogo Copertura aggiornato: le pagine leggono la copia salvata senza ricalcolare il catalogo.');return {errors:0}
}

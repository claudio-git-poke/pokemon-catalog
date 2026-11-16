import {databaseError,isTransientDatabaseError} from './database-errors.mjs'
const cardFields=['total','tagged','missing_image','placeholder','pending','retry','insufficient','unsupported','printings']
const inventoryFields=['inventory_entries','printing_entries','unidentified_entries','pending_identity','missing_exact','candidate_exact','verified_exact','unknown_language']
const key=(...parts)=>JSON.stringify(parts)
const sum=(target,row,fields)=>{for(const f of fields)target[f]=(target[f]||0)+Number(row[f]||0);return target}
const zero=fields=>Object.fromEntries(fields.map(f=>[f,0]))
const check=async q=>{try{const{data,error}=await q;if(error)throw error;return data}catch(error){throw databaseError(error)}}
export function mergeCardBatch(state,batch){
 for(const row of batch.groups){
  const qk=key(row.provider,row.sigla,row.lingua),mk=key(row.source_provider,row.origin_language,row.origin_set)
  const quality=state.quality[qk] ||= {...zero(cardFields),provider:row.provider,sigla:row.sigla,lingua:row.lingua}
  sum(quality,row,cardFields)
  const matrix=state.groups[mk] ||= {...zero(inventoryFields),source_provider:row.source_provider,origin_language:row.origin_language,origin_set:row.origin_set,cards:0,reference_missing:0,placeholder:0,source_printings:0}
  matrix.cards+=Number(row.total);matrix.reference_missing+=Number(row.missing_image);matrix.placeholder+=Number(row.placeholder);matrix.source_printings+=Number(row.printings)
 }
 for(const [reason,n] of Object.entries(batch.warnings?.by_reason||{}))state.warnings.by_reason[reason]=(state.warnings.by_reason[reason]||0)+Number(n)
 state.warnings.samples.push(...(batch.warnings?.samples||[]).slice(0,Math.max(0,30-state.warnings.samples.length)))
 state.card_scanned+=batch.scanned
}
export function mergeInventoryBatch(state,batch){
 for(const row of batch.groups){
  const mk=key(row.source_provider,row.origin_language,row.origin_set)
  const matrix=state.groups[mk] ||= {...zero(inventoryFields),source_provider:row.source_provider,origin_language:row.origin_language,origin_set:row.origin_set,cards:0,reference_missing:0,placeholder:0,source_printings:0}
  sum(matrix,row,inventoryFields)
 }
 for(const row of batch.languages){const target=state.languages[row.language] ||= {...zero(inventoryFields),language:row.language};sum(target,row,inventoryFields)}
 state.inventory_scanned+=batch.scanned
}
export function completedAudit(state,published,at){
 if(state.phase!=='publish')throw Error('Rilevazione incompleta')
 const groups=Object.values(state.quality),totals=groups.reduce((a,g)=>sum(a,g,cardFields),zero(cardFields))
 const inventory=Object.values(state.languages).reduce((a,g)=>sum(a,g,inventoryFields),zero(inventoryFields))
 const warnings={...state.warnings,total:Object.values(state.warnings.by_reason).reduce((a,b)=>a+b,0),shared_verified_images:published.shared_verified_images}
 const quality={generated_at:at,scan_started_at:state.started_at,totals,groups,warnings,published}
 const snapshot={contract:'catalog-coverage-audit-v1',complete:true,started_at:state.started_at,generated_at:at,totals,inventory,published,
  groups:Object.values(state.groups),languages:Object.values(state.languages),card_scanned:state.card_scanned,inventory_scanned:state.inventory_scanned,
  scope:'Voci delle fonti e inventario elaborato; nessun conteggio di tutte le carte fisiche uniche o di tutte le varianti esistenti.'}
 return {snapshot,quality}
}
export async function runCoverageAudit({db,log=console.log,budgetMs=7*60000,clock=Date.now,cardBatchSize=500,inventoryBatchSize=2000,checkpointMs=45000,minAgeMs=25*60000,onProgress=()=>{}}){
 const began=clock(),deadline=began+budgetMs
 const records=await check(db.from('catalog_coverage_snapshots').select('*').in('scope',['latest','checkpoint']))
 let state=records.find(r=>r.scope==='checkpoint')?.report
 const latest=records.find(r=>r.scope==='latest')
 if(state?.version!==1||!state.started_at||Date.parse(state.started_at)<Date.now()-6*3600000)state=null
 if(!state&&latest&&Date.now()-Date.parse(latest.updated_at)<minAgeMs){await log('Copertura: ultima rilevazione ancora recente; nessuna nuova scansione.');return {skipped:true}}
 if(!state){const bounds=await check(db.rpc('catalog_coverage_scan_bounds'));state={version:1,...bounds,phase:'cards',card_cursor:0,inventory_cursor:'',card_scanned:0,inventory_scanned:0,quality:{},groups:{},languages:{},warnings:{by_reason:{},samples:[]}}}
 const save=()=>check(db.from('catalog_coverage_snapshots').upsert({scope:'checkpoint',report:state,updated_at:new Date().toISOString()},{onConflict:'scope'}))
 let savedAt=clock()
 await log(`Copertura: ${state.phase==='cards'?'controllo carte':'ripresa '+state.phase}; ogni query legge un lotto limitato.`)
 try{
  while(clock()<deadline){
   if(state.phase==='cards'){
    const batch=await check(db.rpc('catalog_coverage_card_batch',{after_id:state.card_cursor,until_id:state.card_until,batch_size:cardBatchSize}))
    if(batch.has_more&&(!batch.scanned||Number(batch.next_id)<=state.card_cursor))throw Error('Cursore carte senza avanzamento')
    mergeCardBatch(state,batch);state.card_cursor=Number(batch.next_id)
    if(!batch.has_more){state.phase='inventory';await save();savedAt=clock();await log(`Copertura: ${state.card_scanned} carte lette; controllo versioni e foto dell’inventario.`)}
   }else if(state.phase==='inventory'){
    const batch=await check(db.rpc('catalog_coverage_inventory_batch',{after_key:state.inventory_cursor,until_key:state.inventory_until,batch_size:inventoryBatchSize}))
    if(batch.has_more&&(!batch.scanned||batch.next_key===state.inventory_cursor))throw Error('Cursore inventario senza avanzamento')
    mergeInventoryBatch(state,batch);state.inventory_cursor=batch.next_key
    if(!batch.has_more){state.phase='publish';await save();savedAt=clock()}
   }else if(state.phase==='publish'){
    const published=await check(db.rpc('catalog_coverage_publication_counts'))
    const reports=completedAudit(state,published,new Date().toISOString())
    await check(db.rpc('catalog_publish_coverage_audit',reports))
    await log(`Copertura completata: ${reports.snapshot.totals.total} carte importate, ${reports.snapshot.inventory.printing_entries} voci di varianti, ${reports.snapshot.inventory.missing_exact} senza foto esatta. I totali delle fonti non sono carte fisiche uniche.`)
    return {complete:true,cards:state.card_scanned,inventory:state.inventory_scanned,generated_at:reports.snapshot.generated_at}
   }else throw Error('Fase di controllo non riconosciuta')
   if(clock()-savedAt>=checkpointMs){await save();savedAt=clock();await log(`Copertura: ${state.card_scanned} carte e ${state.inventory_scanned} voci di inventario lette; avanzamento salvato.`)}
   onProgress({phase:state.phase,cards:state.card_scanned,inventory:state.inventory_scanned})
  }
 }catch(error){if(!isTransientDatabaseError(error))throw error;await save();await log(`Copertura: controllo rinviato (${error.message}). Il riepilogo precedente resta disponibile.`);return {deferred:true,cards:state.card_scanned,inventory:state.inventory_scanned}}
 await save();await log('Copertura: tempo della sessione terminato; ripresa dal cursore salvato alla prossima esecuzione.')
 return {deferred:true,cards:state.card_scanned,inventory:state.inventory_scanned}
}

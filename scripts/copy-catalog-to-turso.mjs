import {readFile,writeFile} from 'node:fs/promises'
import {createTursoClient,safeTursoError} from './turso-client.mjs'
import {createSourceReader} from './turso-source-reader.mjs'
import {canonicalJson,hash,initializeSnapshot,copyTable,verifyTable,snapshotReport} from './turso-snapshot.mjs'
let client
try{
 const schema=JSON.parse(await readFile(new URL('../data/turso-source-schema.json',import.meta.url),'utf8'))
 const sourceUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,sourceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
 if(!sourceUrl||!sourceKey)throw Error('Configurare i segreti Supabase di origine già usati dal catalogo.')
 client=(await createTursoClient()).client
 const source=createSourceReader({url:sourceUrl,key:sourceKey}),sourceId=hash(new URL(sourceUrl).origin+'|'+canonicalJson(schema))
 const initialized=await initializeSnapshot(client,schema.tables,sourceId)
 if(!initialized.complete){
  const manualHistory=schema.tables.find(t=>t.table_name==='catalog_manual_history')
  if(await source.count(manualHistory)<146)throw Error('La cronologia manuale di origine non coincide con il controllo iniziale: copia sospesa.')
  const priority=['catalog_manual_history','set_carte','catalog_code_reviews','set_carte_immagini','set_espansioni','catalog_visual_assets','catalog_visual_links','catalog_packaging_documents','catalog_packaging_candidates','catalog_packaging_links','cards','catalog_search_entries','catalog_printing_inventory']
  const tables=[...schema.tables].sort((a,b)=>{
   const rank=t=>t.table_name==='catalog_sync_events'?1000:priority.includes(t.table_name)?priority.indexOf(t.table_name):100
   return rank(a)-rank(b)||a.table_name.localeCompare(b.table_name)
  })
  const deadline=Date.now()+100*60000,log=value=>console.log(JSON.stringify(value))
  for(const table of tables){
   if(Date.now()>deadline-30000)break
   const copied=await copyTable({client,source,table,pageSize:table.table_name==='catalog_sync_events'?1000:table.table_name==='catalog_sync_runs'?20:400,deadline,log})
   if(copied.state==='copying')break
   await verifyTable({client,source,table,pageSize:table.table_name==='catalog_sync_runs'?10:600,deadline,log})
  }
 }
 const report=await snapshotReport(client)
 report.complete=report.verified===schema.tables.length
 report.source_unchanged=true
 report.cutover=false
 report.checked_at=new Date().toISOString()
 if(report.complete)await client.execute({sql:'UPDATE _catalog_snapshot_meta SET complete=1,completed_at=? WHERE id=1',args:[report.checked_at]})
 await writeFile('turso-snapshot-report.json',JSON.stringify(report,null,2))
 console.log(JSON.stringify({phase:'snapshot-report',complete:report.complete,verified_tables:report.verified,total_tables:schema.tables.length,rows:report.rows,manual_rows:report.manual_rows,cutover:false}))
 if(!report.complete)throw Error('Copia parziale salvata: il prossimo avvio riprenderà dai punti verificati.')
}catch(error){
 const message=safeTursoError(error);console.error(message)
 if(client)try{await writeFile('turso-snapshot-report.json',JSON.stringify({...await snapshotReport(client),complete:false,cutover:false,error:message,checked_at:new Date().toISOString()},null,2))}catch{}
 process.exitCode=1
}
finally{client?.close()}

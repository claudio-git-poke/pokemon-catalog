import {initializeSnapshot,copyTable,verifyTable,snapshotReport} from './turso-snapshot.mjs'
import {prepareCatalogSchema} from '../src/server/turso-schema.mjs'
// Offline build of the complete Turso catalog into a local SQLite client:
// verified copy of every table, then indexes, search, tags and manual guards.
export async function buildCatalogFile({client,source,schema,sourceId,deadline=Infinity,log=()=>{},clock=Date.now}){
 const started=clock()
 if((await initializeSnapshot(client,schema.tables,sourceId)).complete)throw Error('File di destinazione non vuoto.')
 for(const table of schema.tables){
  const pageSize=table.table_name==='catalog_sync_runs'?20:1000
  const copied=await copyTable({client,source,table,batchRows:1000,pageSize,deadline,log:value=>{if(value.complete||value.rows%50000===0)log(value)}})
  if(copied.state!=='copied'&&copied.state!=='verified')throw Error('Tempo esaurito durante la copia di '+table.table_name)
  const verified=await verifyTable({client,source,table,pageSize:5000,deadline,log})
  if(verified.state!=='verified')throw Error('Verifica incompleta: '+table.table_name)
 }
 const report=await snapshotReport(client)
 if(report.verified!==schema.tables.length)throw Error('Copia non verificata per tutte le tabelle.')
 await client.execute({sql:'UPDATE _catalog_snapshot_meta SET complete=1,completed_at=? WHERE id=1',args:[new Date(clock()).toISOString()]})
 log({phase:'copy-verified',rows:report.rows,manual_rows:report.manual_rows,minutes:Math.round((clock()-started)/60000)})
 const prepared=await prepareCatalogSchema(client,schema,{log:value=>{if(value.rows%60000===0)log(value)}})
 if(!prepared.ready)throw Error('Preparazione di indici e protezioni non completata.')
 const check=(await client.execute('PRAGMA quick_check')).rows[0]
 if(Object.values(check)[0]!=='ok')throw Error('Controllo di integrità del file non superato.')
 return {report,groups:prepared.groups}
}
// Cheap remote verification: snapshot states plus max(_position) through the
// unique index, so the check reads a few hundred rows instead of the catalog.
export async function verifyUploadedCatalog(remote,report,schema){
 const states=(await remote.execute('SELECT table_name,n,state,chain FROM _catalog_snapshot_state ORDER BY table_name')).rows
 const expected=new Map(report.tables.map(t=>[t.table_name,t]))
 if(states.length!==schema.tables.length)throw Error('Tabelle mancanti nel database caricato.')
 for(const state of states){
  const local=expected.get(state.table_name)
  const last=Number((await remote.execute('SELECT coalesce(max(_position),0) n FROM "_copy_'+state.table_name+'"')).rows[0].n)
  if(!local||Number(state.n)!==Number(local.n)||state.chain!==local.chain||state.state!=='verified'||last!==Number(local.n))throw Error('Verifica remota fallita: '+state.table_name)
 }
 if(Number((await remote.execute('SELECT ready FROM _catalog_api_state WHERE id=1')).rows[0]?.ready)!==1)throw Error('Indici e protezioni non pronti nel database caricato.')
 return states.length
}

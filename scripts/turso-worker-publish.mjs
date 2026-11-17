import {sealWorkerDelta,openWorkerDelta,mergeWorkerChange} from './turso-worker-data.mjs'
import {canonicalJson,hash,recordKey} from './turso-snapshot.mjs'
import {normalizeCatalog} from '../src/server/turso-values.mjs'
import {estimateWrites} from './turso-budget.mjs'
const qid=value=>'"'+String(value).replaceAll('"','""')+'"'
const storage=name=>qid('_copy_'+name)
async function transaction(client,operation){const tx=await client.transaction('write');try{const value=await operation(tx);await tx.commit();return value}catch(error){await tx.rollback();throw error}finally{tx.close()}}
export async function initializeWorkerJournal(client){
 await client.batch([
  "CREATE TABLE IF NOT EXISTS _catalog_worker_journal(run_id TEXT PRIMARY KEY,source_id TEXT NOT NULL,digest TEXT NOT NULL,data_key BLOB,state TEXT NOT NULL,cursor INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL,chunk_count INTEGER NOT NULL,byte_length INTEGER NOT NULL,created_at TEXT NOT NULL,finished_at TEXT)",
  'CREATE TABLE IF NOT EXISTS _catalog_worker_chunks(run_id TEXT NOT NULL,part INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(run_id,part)) WITHOUT ROWID'
 ],'write')
}
export function orderWorkerChanges(schema,changes){
 const done=new Set(),pending=new Map(schema.tables.map(t=>[t.table_name,t])),rank=new Map()
 while(pending.size){
  const available=[...pending.values()].filter(t=>(t.foreign_keys||[]).every(f=>{const name=f.target.replace(/^public\./,'');return name===t.table_name||done.has(name)}))
  if(!available.length)throw Error('Dipendenze circolari fra tabelle del worker.')
  for(const table of available){rank.set(table.table_name,rank.size);done.add(table.table_name);pending.delete(table.table_name)}
 }
 const seen=new Set()
 for(const change of changes){
  const table=schema.tables.find(t=>t.table_name===change.table_name)
  if(!table||change.table_name==='catalog_manual_history')throw Error('Tabella del worker non autorizzata.')
  if(!Array.isArray(change.record_key))throw Error('Chiave della differenza non valida.')
  const key=canonicalJson(change.record_key),identity=change.table_name+'|'+key
  if(seen.has(identity))throw Error('Differenza duplicata.');seen.add(identity)
  for(const row of [change.first_old,change.last_new])if(row!==null&&recordKey(table,row).key!==key)throw Error('Identità della differenza non valida.')
 }
 // Parents are created first; child deletions happen before parent deletions.
 return [...changes].sort((a,b)=>Number(a.last_new===null)-Number(b.last_new===null)||(a.last_new===null?rank.get(b.table_name)-rank.get(a.table_name):rank.get(a.table_name)-rank.get(b.table_name))||(canonicalJson(a.record_key)<canonicalJson(b.record_key)?-1:canonicalJson(a.record_key)>canonicalJson(b.record_key)?1:0))
}
export async function stageWorkerDelta(client,schema,packet,{chunkSize=250000}={}){
 await initializeWorkerJournal(client)
 if(!Number.isSafeInteger(chunkSize)||chunkSize<128||chunkSize>500000)throw Error('Dimensione del blocco non valida.')
 if(packet?.manual_versions?.length&&!packet.changes?.length)throw Error('Una coda manuale non può essere confermata senza differenze pubblicabili.')
 if(!/^\d{1,30}$/.test(packet.run_id))throw Error('Identificativo del worker non valido.')
 const meta=(await client.execute('SELECT source_id,complete FROM _catalog_snapshot_meta WHERE id=1')).rows[0]
 if(!Number(meta?.complete)||packet.source_id!==meta.source_id)throw Error('Origine del worker non corrispondente alla copia verificata.')
 packet={...packet,changes:orderWorkerChanges(schema,packet.changes)}
 const sealed=sealWorkerDelta(packet),parts=Math.ceil(sealed.bytes.length/chunkSize)
 await transaction(client,async tx=>{
  if((await tx.execute("SELECT run_id FROM _catalog_worker_journal WHERE state<>'applied' LIMIT 1")).rows.length)throw Error('Riprendere prima il worker precedente.')
  await tx.execute({sql:"INSERT INTO _catalog_worker_journal(run_id,source_id,digest,data_key,state,total,chunk_count,byte_length,created_at) VALUES(?,?,?,?,'staging',?,?,?,?)",args:[packet.run_id,packet.source_id,sealed.digest,sealed.key,packet.changes.length,parts,sealed.bytes.length,new Date().toISOString()]})
 })
 for(let i=0;i<parts;i++)await client.execute({sql:'INSERT INTO _catalog_worker_chunks(run_id,part,data) VALUES(?,?,?)',args:[packet.run_id,i,sealed.bytes.subarray(i*chunkSize,(i+1)*chunkSize)]})
 await transaction(client,async tx=>{
  const result=(await tx.execute({sql:'SELECT count(*) n,sum(length(data)) bytes FROM _catalog_worker_chunks WHERE run_id=?',args:[packet.run_id]})).rows[0]
  if(Number(result.n)!==parts||Number(result.bytes)!==sealed.bytes.length)throw Error('Archivio del worker incompleto.')
  await tx.execute({sql:"UPDATE _catalog_worker_journal SET state='ready' WHERE run_id=? AND state='staging'",args:[packet.run_id]})
 })
 return {run_id:packet.run_id,changes:packet.changes.length,digest:sealed.digest}
}
export async function discardUnpublishedStages(client){
 await initializeWorkerJournal(client)
 // Only call after the previous job has stopped. Staging never changes catalog
 // rows, and never acknowledges a manual publication version.
 return transaction(client,async tx=>{
  await tx.execute("DELETE FROM _catalog_worker_chunks WHERE run_id IN(SELECT run_id FROM _catalog_worker_journal WHERE state='staging')")
  await tx.execute("DELETE FROM _catalog_worker_journal WHERE state='staging'")
 })
}
async function readPacket(client,runId){
 const journal=(await client.execute({sql:'SELECT * FROM _catalog_worker_journal WHERE run_id=?',args:[runId]})).rows[0]
 if(!journal||!['ready','publishing','applied'].includes(journal.state))throw Error('Archivio del worker non pronto.')
 if(journal.state==='applied')return {journal,packet:null}
 const chunks=(await client.execute({sql:'SELECT part,data FROM _catalog_worker_chunks WHERE run_id=? ORDER BY part',args:[runId]})).rows
 if(chunks.length!==Number(journal.chunk_count)||chunks.some((r,i)=>Number(r.part)!==i))throw Error('Archivio del worker incompleto.')
 const bytes=Buffer.concat(chunks.map(r=>Buffer.from(r.data)))
 if(bytes.length!==Number(journal.byte_length))throw Error('Dimensione dell’archivio non corrispondente.')
 const packet=openWorkerDelta(bytes,Buffer.from(journal.data_key),journal.digest)
 if(packet.run_id!==runId||packet.source_id!==journal.source_id)throw Error('Origine dell’archivio non corrispondente.')
 return {journal,packet}
}
async function readRows(tx,name,keys){
 if(!keys.length)return new Map()
 const rows=(await tx.execute({sql:'SELECT _key,_row,_position FROM '+storage(name)+' WHERE _key IN ('+keys.map(()=>'?').join(',')+')',args:keys})).rows
 return new Map(rows.map(r=>[r._key,{row:JSON.parse(r._row),position:Number(r._position)}]))
}
export async function publishWorkerDelta(client,schema,runId,{batchSize=100,log=()=>{},maxBatches=Infinity,clock=Date.now,writeBudget=Infinity}={}){
 if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>200||maxBatches!==Infinity&&(!Number.isSafeInteger(maxBatches)||maxBatches<0))throw Error('Lotto di pubblicazione non valido.')
 if(writeBudget!==Infinity&&!(Number.isSafeInteger(writeBudget)&&writeBudget>=0))throw Error('Budget di scrittura non valido.')
 const {journal,packet}=await readPacket(client,runId)
 if(!packet)return {run_id:runId,complete:true,already_applied:true}
 const meta=(await client.execute('SELECT source_id FROM _catalog_snapshot_meta WHERE id=1')).rows[0]
 if(packet.source_id!==meta.source_id)throw Error('Origine della pubblicazione non valida.')
 const ordered=orderWorkerChanges(schema,packet.changes)
 if(canonicalJson(ordered)!==canonicalJson(packet.changes))throw Error('Ordine delle differenze non valido.')
 let batches=0,cursor=Number(journal.cursor),estimated=0,budgetReached=false
 while(cursor<packet.changes.length&&batches<maxBatches){
  // Conservative estimate of the Turso rows written by the next batch: stop
  // before the free-plan budget instead of discovering the excess afterwards.
  const nextTable=packet.changes[cursor].table_name,nextRows=Math.min(batchSize,packet.changes.length-cursor)
  if(estimated+estimateWrites(nextTable,nextRows)>writeBudget){budgetReached=true;break}
  batches++
  const before=cursor
  cursor=await transaction(client,async tx=>{
   const saved=(await tx.execute({sql:'SELECT cursor,state FROM _catalog_worker_journal WHERE run_id=?',args:[runId]})).rows[0]
   if(saved.state==='applied')return packet.changes.length
   const offset=Number(saved.cursor),name=packet.changes[offset].table_name
   let end=offset,bytes=0
   while(end<packet.changes.length&&end<offset+batchSize&&packet.changes[end].table_name===name){
    const size=Buffer.byteLength(canonicalJson(packet.changes[end].last_new))
    if(end>offset&&bytes+size>400000)break
    bytes+=size;end++
   }
   const changes=packet.changes.slice(offset,end),keys=changes.map(c=>canonicalJson(c.record_key)),previousRows=await readRows(tx,name,keys)
   const parents=name==='catalog_search_entries'?await readRows(tx,'cards',[...new Set(changes.filter(c=>c.last_new).map(c=>canonicalJson([c.last_new.card_id])))]):new Map()
   let nextPosition=Number((await tx.execute('SELECT coalesce(max(_position),0) n FROM '+storage(name))).rows[0].n)
   const writes=[],deletes=[]
   for(const change of changes){
    if(name==='catalog_live_updates')continue
    const key=canonicalJson(change.record_key),previous=previousRows.get(key),result=mergeWorkerChange(change.first_old,change.last_new,previous?.row??null)
    if(result.operation==='conflict')throw Error('Nuova identità già occupata: pubblicazione sospesa.')
    if(result.operation==='delete'){deletes.push(key);continue}
    if(result.operation!=='write')continue
    const row=result.row
    if(name==='catalog_search_entries'){
     const parent=parents.get(canonicalJson([row.card_id]));if(!parent)throw Error('Carta genitore della stampa non disponibile.')
     let projected=false
     for(const [field,source]of [['name','nome'],['set_code','sigla'],['language','lingua']])if(!Object.hasOwn(row.manual_overrides||{},field)&&Object.hasOwn(parent.row.manual_overrides||{},source)){row[field]=parent.row[source]??(field==='name'?'':null);projected=true}
     if(projected&&!Object.hasOwn(row.manual_overrides||{},'search_text'))row.search_text=normalizeCatalog([row.name,row.set_code,row.collector_number,row.label,...row.tags||[]].join(' '))
    }
    const timestamp=new Date(clock()).toISOString()
    // Feed timestamps belong to publication time, so consumers cannot advance
    // past a change computed earlier in a temporary worker.
    for(const field of ['updated_at','aggiornato_il'])if(Object.hasOwn(row,field))row[field]=timestamp
    const position=previous?.position??++nextPosition
    const json=canonicalJson(row)
    writes.push({key,row:json,digest:hash(json),position})
   }
   const statements=["UPDATE _catalog_write_context SET mode='automatic',reason='turso_worker_publish' WHERE id=1"]
   if(writes.length)statements.push({sql:'INSERT INTO '+storage(name)+"(_key,_row,_hash,_position) SELECT json_extract(value,'$.key'),json_extract(value,'$.row'),json_extract(value,'$.digest'),json_extract(value,'$.position') FROM json_each(?) WHERE 1 ON CONFLICT(_key) DO UPDATE SET _row=excluded._row,_hash=excluded._hash",args:[JSON.stringify(writes)]})
   if(deletes.length)statements.push({sql:'DELETE FROM '+storage(name)+' WHERE _key IN('+deletes.map(()=>'?').join(',')+')',args:deletes})
   await tx.batch(statements)
   const finalRows=await readRows(tx,name,writes.map(w=>w.key)),hashes=[...finalRows].map(([key,r])=>({key,digest:hash(canonicalJson(r.row))}))
   const finish=[]
   if(hashes.length)finish.push({sql:'UPDATE '+storage(name)+" SET _hash=(SELECT json_extract(value,'$.digest') FROM json_each(?) WHERE json_extract(value,'$.key')=_key) WHERE _key IN (SELECT json_extract(value,'$.key') FROM json_each(?))",args:[JSON.stringify(hashes),JSON.stringify(hashes)]})
   finish.push({sql:"UPDATE _catalog_worker_journal SET cursor=?,state='publishing' WHERE run_id=?",args:[end,runId]},"UPDATE _catalog_write_context SET mode='manual',reason=NULL WHERE id=1")
   await tx.batch(finish)
   return end
  })
  estimated+=estimateWrites(nextTable,cursor-before)
  await log({phase:'publish-worker',run_id:runId,rows:cursor,total:packet.changes.length,estimated_writes:estimated})
 }
 if(cursor===packet.changes.length){
  await transaction(client,async tx=>{
   for(const version of packet.manual_versions||[]){
    if(!schema.tables.some(t=>t.table_name===version.table_name)||!Number.isSafeInteger(version.version)||typeof version.record_key!=='string')throw Error('Versione manuale non valida.')
    await tx.execute({sql:'DELETE FROM _catalog_manual_outbox WHERE table_name=? AND record_key=? AND version=?',args:[version.table_name,version.record_key,version.version]})
   }
   await tx.execute({sql:"UPDATE _catalog_worker_journal SET state='applied',data_key=NULL,finished_at=? WHERE run_id=?",args:[new Date(clock()).toISOString(),runId]})
   await tx.execute({sql:'DELETE FROM _catalog_worker_chunks WHERE run_id=?',args:[runId]})
  })
 }
 return {run_id:runId,complete:cursor===packet.changes.length,rows:cursor,total:packet.changes.length,estimated_writes:estimated,budget_reached:budgetReached}
}

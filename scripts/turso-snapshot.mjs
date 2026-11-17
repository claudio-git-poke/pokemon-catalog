import {createHash} from 'node:crypto'
import {validateTable} from './turso-source-reader.mjs'
export const EMPTY_CHAIN=createHash('sha256').update('').digest('hex')
export function canonicalJson(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value)
 if(typeof value==='number'){
  if(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value))throw Error('Numero non rappresentabile senza perdita.')
  return JSON.stringify(value)
 }
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']'
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')+'}'
 throw Error('Valore JSON non valido.')
}
export const hash=value=>createHash('sha256').update(value).digest('hex')
export const chain=(previous,key,rowHash)=>hash(canonicalJson([previous,key,rowHash]))
const mirror=table=>'"_copy_'+validateTable(table).table_name+'"'
export function recordKey(table,row){
 validateTable(table)
 const values=table.primary_key.map(k=>{const v=row[k];if(typeof v!=='string'&&!(typeof v==='number'&&Number.isSafeInteger(v)))throw Error('Chiave primaria incompleta: '+table.table_name);return v})
 return {values,key:canonicalJson(values)}
}
function manualHash(key,row){
 const overrides=row.manual_overrides
 if(!overrides||typeof overrides!=='object'||!Object.keys(overrides).length)return null
 return hash(canonicalJson([key,overrides,Object.fromEntries(Object.keys(overrides).map(k=>[k,row[k]??null]))]))
}
export async function initializeSnapshot(client,tables,sourceId){
 await client.batch([
  `CREATE TABLE IF NOT EXISTS _catalog_snapshot_meta(id INTEGER PRIMARY KEY CHECK(id=1),source_id TEXT NOT NULL,complete INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,completed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS _catalog_snapshot_state(table_name TEXT PRIMARY KEY,cursor TEXT,n INTEGER NOT NULL DEFAULT 0,chain TEXT NOT NULL,manual_n INTEGER NOT NULL DEFAULT 0,manual_chain TEXT NOT NULL,state TEXT NOT NULL,source_count INTEGER NOT NULL,verify_position INTEGER NOT NULL DEFAULT 0,verify_chain TEXT NOT NULL,verify_manual_n INTEGER NOT NULL DEFAULT 0,verify_manual_chain TEXT NOT NULL,updated_at TEXT NOT NULL)`,
  {sql:'INSERT INTO _catalog_snapshot_meta(id,source_id,created_at) VALUES(1,?,?) ON CONFLICT(id) DO NOTHING',args:[sourceId,new Date().toISOString()]}
 ],'write')
 const saved=(await client.execute('SELECT source_id,complete FROM _catalog_snapshot_meta WHERE id=1')).rows[0]
 if(saved.source_id!==sourceId)throw Error('Questa copia appartiene a un’origine o a uno schema differente.')
 if(Number(saved.complete))return {complete:true}
 for(const table of tables)await client.execute(`CREATE TABLE IF NOT EXISTS ${mirror(table)}(_key TEXT PRIMARY KEY,_row TEXT NOT NULL CHECK(json_valid(_row)),_hash TEXT NOT NULL,_position INTEGER NOT NULL UNIQUE)`)
 return {complete:false}
}
export async function getSnapshotState(client,table){return(await client.execute({sql:'SELECT * FROM _catalog_snapshot_state WHERE table_name=?',args:[table.table_name]})).rows[0]}
export async function copyTable({client,source,table,pageSize=400,deadline=Infinity,clock=Date.now,log=()=>{}}){
 let saved=await getSnapshotState(client,table)
 if(saved&&['copied','verified'].includes(saved.state))return saved
 const count=await source.count(table)
 if(saved&&Number(saved.source_count)!==count)throw Error('L’origine è cambiata durante la copia: '+table.table_name)
 if(!saved){
  await client.execute({sql:'INSERT INTO _catalog_snapshot_state(table_name,chain,manual_chain,state,source_count,verify_chain,verify_manual_chain,updated_at) VALUES(?,?,?,?,?,?,?,?)',args:[table.table_name,EMPTY_CHAIN,EMPTY_CHAIN,'copying',count,EMPTY_CHAIN,EMPTY_CHAIN,new Date(clock()).toISOString()]})
  saved=await getSnapshotState(client,table)
 }
 while(clock()<deadline-30000){
  const cursor=saved.cursor?JSON.parse(saved.cursor):null,rows=await source.page(table,cursor,pageSize)
  if(rows.length>pageSize)throw Error('Pagina troppo grande: '+table.table_name)
  let n=Number(saved.n),currentChain=saved.chain,manualN=Number(saved.manual_n),manualChain=saved.manual_chain,lastCursor=cursor
  const statements=[],seen=new Set()
  for(const row of rows){
   const {key,values}=recordKey(table,row),serialized=canonicalJson(row),digest=hash(serialized)
   if(seen.has(key)||canonicalJson(values)===saved.cursor)throw Error('Cursore duplicato: '+table.table_name)
   seen.add(key);n++;currentChain=chain(currentChain,key,digest);lastCursor=values
   const protectedHash=manualHash(key,row);if(protectedHash){manualN++;manualChain=chain(manualChain,key,protectedHash)}
   statements.push({sql:`INSERT INTO ${mirror(table)}(_key,_row,_hash,_position) VALUES(?,?,?,?) ON CONFLICT(_key) DO UPDATE SET _row=excluded._row,_hash=excluded._hash,_position=excluded._position WHERE _hash<>excluded._hash OR _position<>excluded._position`,args:[key,serialized,digest,n]})
  }
  const complete=rows.length<pageSize
  if(n>count||complete&&(n!==count||await source.count(table)!==count))throw Error('Conteggio origine cambiato: '+table.table_name)
  const nextCursor=lastCursor?canonicalJson(lastCursor):null
  if(rows.length&&nextCursor===saved.cursor)throw Error('La pagina non avanza: '+table.table_name)
  // Bound HTTP request size. Only the final transaction acknowledges this page;
  // replaying an interrupted page reuses the same keys and positions.
  let batch=[],bytes=0
  for(const statement of statements){
   const size=Buffer.byteLength(JSON.stringify(statement))
   if(batch.length&&(batch.length>=150||bytes+size>750000)){await client.batch(batch,'write');batch=[];bytes=0}
   batch.push(statement);bytes+=size
  }
  batch.push({sql:'UPDATE _catalog_snapshot_state SET cursor=?,n=?,chain=?,manual_n=?,manual_chain=?,state=?,updated_at=? WHERE table_name=?',args:[nextCursor,n,currentChain,manualN,manualChain,complete?'copied':'copying',new Date(clock()).toISOString(),table.table_name]})
  await client.batch(batch,'write')
  saved=await getSnapshotState(client,table)
  await log({table:table.table_name,phase:'copy',rows:n,total:count,manual:manualN,complete})
  if(complete)return saved
 }
 return saved
}
export async function verifyTable({client,source,table,pageSize=600,deadline=Infinity,clock=Date.now,log=()=>{}}){
 let saved=await getSnapshotState(client,table)
 if(saved?.state==='verified')return saved
 if(saved?.state!=='copied')return saved
 while(clock()<deadline-30000){
  const rows=(await client.execute({sql:`SELECT _key,_row,_hash,_position FROM ${mirror(table)} WHERE _position>? ORDER BY _position LIMIT ?`,args:[Number(saved.verify_position),pageSize]})).rows
  let position=Number(saved.verify_position),currentChain=saved.verify_chain,manualN=Number(saved.verify_manual_n),manualChain=saved.verify_manual_chain
  for(const item of rows){
   const row=JSON.parse(item._row),key=recordKey(table,row).key,digest=hash(canonicalJson(row))
   if(Number(item._position)!==position+1||key!==item._key||digest!==item._hash)throw Error('Verifica contenuto fallita: '+table.table_name)
   position++;currentChain=chain(currentChain,key,digest)
   const protectedHash=manualHash(key,row);if(protectedHash){manualN++;manualChain=chain(manualChain,key,protectedHash)}
  }
  const complete=rows.length<pageSize
  if(complete){
   const targetCount=Number((await client.execute(`SELECT count(*) n FROM ${mirror(table)}`)).rows[0].n)
   if(position!==Number(saved.n)||targetCount!==position||await source.count(table)!==position||currentChain!==saved.chain||manualN!==Number(saved.manual_n)||manualChain!==saved.manual_chain)throw Error('Conteggi o hash discordanti: '+table.table_name)
  }
  await client.execute({sql:'UPDATE _catalog_snapshot_state SET verify_position=?,verify_chain=?,verify_manual_n=?,verify_manual_chain=?,state=?,updated_at=? WHERE table_name=?',args:[position,currentChain,manualN,manualChain,complete?'verified':'copied',new Date(clock()).toISOString(),table.table_name]})
  saved=await getSnapshotState(client,table)
  if(complete){await log({table:table.table_name,phase:'verified',rows:position,manual:manualN,chain:currentChain});return saved}
 }
 return saved
}
export async function snapshotReport(client){
 const rows=(await client.execute('SELECT table_name,n,manual_n,state,chain,manual_chain,verify_position,source_count FROM _catalog_snapshot_state ORDER BY table_name')).rows
 return {tables:rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='bigint'?Number(v):v]))),rows:rows.reduce((n,r)=>n+Number(r.n),0),manual_rows:rows.reduce((n,r)=>n+Number(r.manual_n),0),verified:rows.filter(r=>r.state==='verified').length}
}

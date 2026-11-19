import {readFile,appendFile} from 'node:fs/promises'
import pg from 'pg'
import {connectCatalogDatabase,pendingWorkerJournals,prepareWorkerDatabase} from './turso-worker-runtime.mjs'
import {discardUnpublishedStages} from './turso-worker-publish.mjs'
import {safeTursoError} from './turso-client.mjs'
// Decides the mode of this run and, for new work, restores the catalog from
// Turso into the disposable PostgreSQL service of the job.
const log=value=>console.log(JSON.stringify(value))
const output=async(key,value)=>{if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`${key}=${value}\n`)}
let client,db,exit=0
async function recentWork(client){
 const minutes=Number(process.env.WORK_INTERVAL_MINUTES||0)
 if(!(minutes>0))return false
 try{
  const last=Date.parse((await client.execute('SELECT last_work_at FROM _catalog_worker_state WHERE id=1')).rows[0]?.last_work_at||'')
  return Number.isFinite(last)&&Date.now()-last<minutes*60000
 }catch{return false}
}
try{
 // Restoring reads about one row per catalog row: keep a wide margin.
 if(Number(process.env.READ_BUDGET||0)<2_500_000){log({phase:'skip',reason:'Letture Turso residue insufficienti per un ripristino completo.'});await output('mode','skip')}
 else{
  ({client}=await connectCatalogDatabase())
  const pending=await pendingWorkerJournals(client)
  if(pending.length){
   log({phase:'resume',pending})
   await output('mode','resume')
  }else if(await recentWork(client)){
   log({phase:'skip',reason:'Coda vuota e ultimo giro di lavoro troppo recente: niente nuovo ripristino in questo turno.'})
   await output('mode','skip')
  }else{
   // Remember when the catalog was last restored: frequent publishing turns
   // must not restore it (about one million reads) more often than needed.
   await client.batch(['CREATE TABLE IF NOT EXISTS _catalog_worker_state(id INTEGER PRIMARY KEY CHECK(id=1),last_work_at TEXT NOT NULL)',{sql:'INSERT INTO _catalog_worker_state(id,last_work_at) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET last_work_at=excluded.last_work_at',args:[new Date().toISOString()]}],'write')
   await discardUnpublishedStages(client)
   const snapshot=JSON.parse(await readFile(new URL('../data/turso-worker-pg-schema.json',import.meta.url),'utf8'))
   db=new pg.Client({connectionString:process.env.WORKER_PG_URL})
   await db.connect()
   const started=Date.now()
   await prepareWorkerDatabase({client,snapshot,executeSql:sql=>db.query(sql),authenticatorPassword:process.env.WORKER_AUTHENTICATOR_PASSWORD,log})
   log({phase:'restored',minutes:Math.round((Date.now()-started)/60000)})
   await output('mode','work')
  }
 }
}catch(error){console.error(safeTursoError(error));exit=1}
finally{client?.close();await db?.end().catch(()=>{});process.exitCode=exit}

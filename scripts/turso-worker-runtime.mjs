import {createHmac} from 'node:crypto'
import {workerSchemaStatements} from './turso-worker-schema.mjs'
import {hydrateWorker,captureDeltaStatements} from './turso-worker-data.mjs'
import {orderWorkerChanges,stageWorkerDelta,publishWorkerDelta,initializeWorkerJournal} from './turso-worker-publish.mjs'
import {canonicalJson} from './turso-snapshot.mjs'
import {estimateWrites} from './turso-budget.mjs'
import {createPlatform,platformConfiguration,validDatabaseName} from './turso-platform.mjs'
// Worker cycle on Turso:
// 1. restore the catalog into a disposable PostgreSQL (same schema, triggers
//    and permissions as the original Supabase project);
// 2. run the unchanged importers through PostgREST on that database;
// 3. collect the changed rows and publish them to Turso in resumable,
//    budget-limited packets. Nothing else is written to Turso.

// Rows that never reach Turso: technical log (GitHub Actions keeps it), the
// realtime counter (maintained by the Turso guards) and the append-only manual
// history (written only by manual edits on Turso).
export const UNPUBLISHED_TABLES=new Set(['catalog_sync_events','catalog_live_updates','catalog_manual_history'])

export async function connectCatalogDatabase(env=process.env,{expiration='8h',fetchImpl=fetch,clientFetch,authorization='full-access'}={}){
 const platform=createPlatform(platformConfiguration(env),{fetchImpl})
 const name=validDatabaseName(env.TURSO_DATABASE_NAME||'pokemon-catalog')
 const database=(await platform.databases()).find(d=>d.Name===name)
 if(!database?.Hostname)throw Error('Database Turso '+name+' non trovato sull’account configurato.')
 const authToken=await platform.databaseToken(name,{expiration,authorization})
 const {createClient}=await import('@libsql/client/web')
 return {client:createClient({url:'libsql://'+database.Hostname,authToken,...(clientFetch?{fetch:clientFetch}:{})}),name}
}

export async function pendingWorkerJournals(client){
 await initializeWorkerJournal(client)
 return (await client.execute("SELECT run_id FROM _catalog_worker_journal WHERE state IN ('ready','publishing') ORDER BY created_at,run_id")).rows.map(r=>String(r.run_id))
}

// executeSql must keep one session: hydration disables triggers per session.
export async function prepareWorkerDatabase({client,snapshot,executeSql,authenticatorPassword,log=()=>{}}){
 if(!/^[A-Za-z0-9]{16,64}$/.test(authenticatorPassword||''))throw Error('Password del ruolo authenticator non valida.')
 for(const [index,sql]of workerSchemaStatements(snapshot).entries()){
  try{await executeSql(sql)}catch(error){throw Error('Schema del worker, istruzione '+index+': '+error.message)}
 }
 // PostgREST logs in as authenticator and switches to the role of the JWT, as on Supabase.
 await executeSql(`DO $r$ BEGIN CREATE ROLE authenticator LOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $r$; ALTER ROLE authenticator PASSWORD '${authenticatorPassword}'; GRANT anon,authenticated,service_role TO authenticator;`)
 await hydrateWorker({client,snapshot,executeSql,log})
 for(const sql of captureDeltaStatements(snapshot))await executeSql(sql)
 log({phase:'worker-ready'})
}

export async function collectWorkerChanges(querySql){
 const rows=await querySql('SELECT table_name,record_key,first_old,last_new FROM catalog_internal.turso_worker_delta ORDER BY table_name,record_key::text')
 const changes=[],skipped={},unchanged={}
 for(const row of rows){
  if(UNPUBLISHED_TABLES.has(row.table_name)){skipped[row.table_name]=(skipped[row.table_name]||0)+1;continue}
  // Inserted and deleted again, or changed and restored: nothing to publish.
  if(canonicalJson(row.first_old)===canonicalJson(row.last_new)){unchanged[row.table_name]=(unchanged[row.table_name]||0)+1;continue}
  changes.push({table_name:row.table_name,record_key:row.record_key,first_old:row.first_old,last_new:row.last_new})
 }
 return {changes,skipped,unchanged}
}

export function summarizeChanges(changes){
 const tables={}
 for(const change of changes){
  const entry=tables[change.table_name]||={inserts:0,updates:0,deletes:0,estimated_writes:0}
  entry[change.first_old===null?'inserts':change.last_new===null?'deletes':'updates']++
  entry.estimated_writes+=estimateWrites(change.table_name)
 }
 return {changes:changes.length,estimated_writes:Object.values(tables).reduce((n,t)=>n+t.estimated_writes,0),tables}
}

// Parents first, child deletions before parent deletions, then split into
// packets that each fit the sealed-archive limits.
export function packWorkerChanges(schema,changes,{maxChanges=10000,maxBytes=40*1024*1024}={}){
 const parts=[];let current=[],bytes=0
 for(const change of orderWorkerChanges(schema,changes)){
  const size=Buffer.byteLength(canonicalJson(change))
  if(size>maxBytes)throw Error('Differenza troppo grande: '+change.table_name)
  if(current.length&&(current.length>=maxChanges||bytes+size>maxBytes)){parts.push(current);current=[];bytes=0}
  current.push(change);bytes+=size
 }
 if(current.length)parts.push(current)
 return parts
}

export async function stageWorkerRun(client,schema,{runId,changes}){
 if(!/^\d{1,26}$/.test(String(runId)))throw Error('Identificativo dell’esecuzione non valido.')
 const meta=(await client.execute('SELECT source_id,complete FROM _catalog_snapshot_meta WHERE id=1')).rows[0]
 if(!Number(meta?.complete))throw Error('Copia Turso non verificata.')
 const parts=packWorkerChanges(schema,changes),staged=[]
 for(const [index,part]of parts.entries()){
  const packet={contract:'catalog-worker-delta-v1',run_id:String(runId)+String(index).padStart(3,'0'),source_id:meta.source_id,manual_versions:[],changes:part}
  staged.push(await stageWorkerDelta(client,schema,packet,{allowPending:index>0}))
 }
 return staged
}

// Publishes pending packets in order until the write budget or the deadline.
export async function publishPendingWork(client,schema,{writeBudget,deadline=Infinity,clock=Date.now,log=()=>{}}){
 let remaining=writeBudget,published=0
 const result={journals:[],estimated_writes:0,complete:true}
 for(const runId of await pendingWorkerJournals(client)){
  if(clock()>deadline||remaining<=0){result.complete=false;break}
  let outcome
  do{
   outcome=await publishWorkerDelta(client,schema,runId,{writeBudget:remaining,maxBatches:20,log,clock})
   remaining-=outcome.estimated_writes||0;result.estimated_writes+=outcome.estimated_writes||0
  }while(!outcome.complete&&!outcome.budget_reached&&clock()<=deadline&&(outcome.estimated_writes||0)>0)
  result.journals.push({run_id:runId,complete:outcome.complete,rows:outcome.rows,total:outcome.total})
  if(!outcome.complete){result.complete=false;break}
  published++
 }
 return {...result,published}
}

// Service-role token for the local PostgREST only (random secret per run).
export function signServiceRoleToken(secret,{now=Date.now(),hours=12}={}){
 if(!/^[a-f0-9]{64}$/.test(secret||''))throw Error('Segreto JWT locale non valido.')
 const part=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
 const body=part({alg:'HS256',typ:'JWT'})+'.'+part({role:'service_role',iss:'turso-worker',iat:Math.floor(now/1000),exp:Math.floor(now/1000)+hours*3600})
 return body+'.'+createHmac('sha256',secret).update(body).digest('base64url')
}

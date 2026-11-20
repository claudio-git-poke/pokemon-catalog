import {readFile,writeFile,stat} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {spawn} from 'node:child_process'
import {appendFile} from 'node:fs/promises'
import pg from 'pg'
import {connectCatalogDatabase,prepareWorkerDatabase} from './turso-worker-runtime.mjs'
import {safeTursoError} from './turso-client.mjs'
// Prepares the disposable PostgreSQL of a "local copy" run. The catalog comes
// from the copy saved by the previous local run (pg_dump in the Actions cache)
// so that runs build on each other without reading or writing Turso; only the
// very first run restores it from Turso. Work groups alternate A, B, A, ...
const log=value=>console.log(JSON.stringify(value))
const output=async(key,value)=>{if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`${key}=${value}\n`)}
const dir=process.env.LOCAL_COPY_DIR||'/tmp/local-copy',dump=dir+'/catalog.dump',stateFile=dir+'/state.json'
const exists=async path=>{try{return (await stat(path)).size>0}catch{return false}}
const restoreDump=container=>new Promise((resolve,reject)=>{
 // PG_CONTAINER=local uses the pg_restore of this machine (tests only).
 if(container!=='local'&&!/^[a-f0-9]{12,64}$/.test(container||''))return reject(Error('Contenitore PostgreSQL non valido.'))
 const args=['--exit-on-error','--no-password']
 const child=container==='local'?spawn('pg_restore',['-d',process.env.WORKER_PG_URL,...args],{stdio:['pipe','inherit','inherit']}):spawn('docker',['exec','-i',container,'pg_restore','-U','postgres','-d','postgres',...args],{stdio:['pipe','inherit','inherit']})
 createReadStream(dump).pipe(child.stdin)
 child.on('error',reject)
 child.on('close',code=>code===0?resolve():reject(Error('pg_restore terminato con codice '+code)))
})
let db,client,exit=0
try{
 const password=process.env.WORKER_AUTHENTICATOR_PASSWORD
 if(!/^[A-Za-z0-9]{16,64}$/.test(password||''))throw Error('Password del ruolo authenticator non valida.')
 db=new pg.Client({connectionString:process.env.WORKER_PG_URL});await db.connect()
 const started=Date.now()
 let source
 if(await exists(dump)){
  // Roles live outside the dumped database: create them before restoring grants.
  await db.query(`DO $r$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $r$;
   DO $r$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $r$;
   DO $r$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $r$;
   DO $r$ BEGIN CREATE ROLE authenticator LOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $r$;
   GRANT anon,authenticated,service_role TO authenticator;`)
  await restoreDump(process.env.PG_CONTAINER)
  source='local'
 }else{
  if(process.env.REQUIRE_LOCAL_COPY==='true')throw Error('Nessuna copia locale salvata da caricare.')
  const snapshot=JSON.parse(await readFile(new URL('../data/turso-worker-pg-schema.json',import.meta.url),'utf8'))
  ;({client}=await connectCatalogDatabase())
  await prepareWorkerDatabase({client,snapshot,executeSql:sql=>db.query(sql),authenticatorPassword:password,log})
  source='turso'
 }
 await db.query(`ALTER ROLE authenticator PASSWORD '${password}'`)
 // Deltas are only needed to publish to Turso: the copy itself is the result.
 await db.query('TRUNCATE catalog_internal.turso_worker_delta')
 let state={}
 try{state=JSON.parse(await readFile(stateFile,'utf8'))}catch{}
 const group=state.last_group==='A'?'B':'A'
 state={...state,last_group:group,runs:Number(state.runs||0)+1,last_run_at:new Date().toISOString(),first_source:state.first_source||source}
 await writeFile(stateFile,JSON.stringify(state))
 log({phase:'local-copy-ready',source,group,runs:state.runs,minutes:Math.round((Date.now()-started)/60000)})
 await output('mode','work');await output('group',group);await output('source',source)
}catch(error){console.error(safeTursoError(error));exit=1}
finally{client?.close();await db?.end().catch(()=>{});process.exitCode=exit}

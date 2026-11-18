import {readFile} from 'node:fs/promises'
import pg from 'pg'
import {connectCatalogDatabase,collectWorkerChanges,summarizeChanges,stageWorkerRun,publishPendingWork} from './turso-worker-runtime.mjs'
import {safeTursoError} from './turso-client.mjs'
// Collects what the importers changed in the disposable PostgreSQL and
// publishes it to Turso within the write budget of this run. With
// WORKER_PUBLISH other than "true" it only reports (dry run).
const log=value=>console.log(JSON.stringify(value))
let client,db,exit=0
try{
 const mode=process.env.WORKER_MODE,publish=process.env.WORKER_PUBLISH==='true'
 const writeBudget=Number(process.env.WRITE_BUDGET||0)
 if(!['work','resume'].includes(mode))throw Error('Modalità del worker non valida: '+mode)
 if(!Number.isSafeInteger(writeBudget)||writeBudget<0)throw Error('Budget di scrittura non valido.')
 const schema=JSON.parse(await readFile(new URL('../data/turso-source-schema.json',import.meta.url),'utf8'))
 ;({client}=await connectCatalogDatabase())
 if(mode==='work'){
  db=new pg.Client({connectionString:process.env.WORKER_PG_URL});await db.connect()
  const {changes,skipped,unchanged}=await collectWorkerChanges(async sql=>(await db.query(sql)).rows)
  log({phase:'collected',...summarizeChanges(changes),skipped,unchanged})
  if(!publish)log({phase:'dry-run',message:'Nessuna scrittura su Turso: esecuzione di prova.'})
  else if(changes.length){
   const runId=String(process.env.GITHUB_RUN_ID||Date.now())+String(process.env.GITHUB_RUN_ATTEMPT||1)
   const staged=await stageWorkerRun(client,schema,{runId,changes})
   log({phase:'staged',packets:staged.length,changes:changes.length})
  }
 }
 if(publish){
  const deadline=Date.now()+Number(process.env.PUBLISH_MINUTES||45)*60000
  const result=await publishPendingWork(client,schema,{writeBudget,deadline,log:value=>{if(value.rows%1000===0||value.rows===value.total)log(value)}})
  log({phase:'published',...result,write_budget:writeBudget})
 }
}catch(error){console.error(safeTursoError(error));exit=1}
finally{client?.close();await db?.end().catch(()=>{});process.exitCode=exit}

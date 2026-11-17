import {readFile,stat,rm} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {Readable} from 'node:stream'
import {createSourceReader} from './turso-source-reader.mjs'
import {canonicalJson,hash} from './turso-snapshot.mjs'
import {sqliteFileClient} from './sqlite-file-client.mjs'
import {buildCatalogFile,verifyUploadedCatalog} from './turso-file-build.mjs'
import {createPlatform,platformConfiguration,ensureGroup,uploadDatabaseFile,validDatabaseName} from './turso-platform.mjs'
import {safeTursoError} from './turso-client.mjs'
// Builds the complete Turso catalog as a local SQLite file and, with
// UPLOAD=true, uploads it as the initial content of a NEW database.
// Supabase is only read (GET/HEAD). No SQL write reaches Turso.
const log=value=>console.log(JSON.stringify(value))
const file=process.env.CATALOG_FILE||'/tmp/pokemon-catalog.db'
const upload=process.env.UPLOAD==='true'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const cleanup=()=>Promise.all(['','-wal','-shm'].map(s=>rm(file+s,{force:true}).catch(()=>{})))
let client,exit=0
try{
 const target=validDatabaseName(process.env.TURSO_TARGET_DATABASE||'pokemon-catalog')
 const schema=JSON.parse(await readFile(new URL('../data/turso-source-schema.json',import.meta.url),'utf8'))
 const sourceUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,sourceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
 if(!sourceUrl||!sourceKey)throw Error('Configurare i segreti Supabase di origine già usati dal catalogo.')
 let platform
 if(upload){
  platform=createPlatform(platformConfiguration())
  // Fail before spending Supabase traffic on a build that cannot be uploaded.
  if((await platform.databases()).some(d=>d.Name===target))throw Error('Il database '+target+' esiste già: nessuna sostituzione automatica.')
  log({phase:'usage-before',...await platform.usage()})
 }
 const source=createSourceReader({url:sourceUrl,key:sourceKey}),sourceId=hash(new URL(sourceUrl).origin+'|'+canonicalJson(schema))
 if(await source.count(schema.tables.find(t=>t.table_name==='catalog_manual_history'))<146)throw Error('La cronologia manuale di origine non coincide con il controllo iniziale: costruzione sospesa.')
 await cleanup()
 client=sqliteFileClient(file,{fast:true})
 const started=Date.now()
 const {report,groups}=await buildCatalogFile({client,source,schema,sourceId,deadline:started+170*60000,log})
 client.exec('PRAGMA optimize;');client.checkpoint();client.close();client=null
 const size=(await stat(file)).size
 log({phase:'file-ready',bytes:size,groups,minutes:Math.round((Date.now()-started)/60000)})
 if(upload){
  const group=await ensureGroup(platform,log)
  const database=await platform.createUploadDatabase(target,group)
  const jwt=await platform.databaseToken(target)
  log({phase:'uploading',database:target,hostname:database.Hostname,bytes:size})
  await uploadDatabaseFile({hostname:database.Hostname,jwt,body:Readable.toWeb(createReadStream(file)),size})
  const {createClient}=await import('@libsql/client/web')
  const remote=createClient({url:'libsql://'+database.Hostname,authToken:jwt})
  let tables
  for(let attempt=0;attempt<30&&!tables;attempt++){
   try{tables=await verifyUploadedCatalog(remote,report,schema)}
   catch(error){if(/Verifica remota|mancanti|non pronti/.test(error.message))throw error;log({phase:'waiting-database',attempt,error:safeTursoError(error).slice(0,120)});await sleep(10000)}
  }
  remote.close()
  if(!tables)throw Error('Database caricato non raggiungibile.')
  log({phase:'uploaded-and-verified',database:target,hostname:database.Hostname,tables,rows:report.rows,cutover:false})
 }
}catch(error){console.error(safeTursoError(error));exit=1}
finally{
 try{client?.close()}catch{}
 await cleanup()
 process.exitCode=exit
}

import {DatabaseSync} from 'node:sqlite'
import {readFile,rm} from 'node:fs/promises'
import {createPlatform,platformConfiguration,uploadDatabaseFile,ensureGroup} from './turso-platform.mjs'
import {safeTursoError} from './turso-client.mjs'
// Measures whether uploading a SQLite file counts as rows written.
// The probe file holds 50,000 rows plus one index (about 100,000 rows written
// if loaded with SQL). A control write of 100 rows proves that the usage
// counter is moving during the observation window. The probe database is
// always deleted at the end.
const KEEP=process.env.PROBE_KEEP==='true',ROWS=50000,CONTROL=100,file='/tmp/turso-upload-probe.db',sleep=ms=>new Promise(r=>setTimeout(r,ms))
const log=value=>console.log(JSON.stringify(value))
let platform,name,created=false,exit=0
try{
 platform=createPlatform(platformConfiguration())
 if(process.env.PROBE_CLEANUP==='true'){
  const present=(await platform.databases()).some(d=>d.Name==='upload-probe')
  if(present)await platform.deleteDatabase('upload-probe')
  log({phase:'cleanup',database:'upload-probe',deleted:present})
  process.exit(0)
 }
 const before=await platform.usage();log({phase:'usage-before',...before})
 const group=await ensureGroup(platform,log)
 log({phase:'group',group,databases:(await platform.databases()).length})
 await rm(file,{force:true})
 const db=new DatabaseSync(file)
 db.exec("PRAGMA journal_mode=WAL;CREATE TABLE probe(id INTEGER PRIMARY KEY,value TEXT NOT NULL);CREATE INDEX probe_value ON probe(value);BEGIN")
 const insert=db.prepare('INSERT INTO probe(id,value) VALUES(?,?)')
 for(let i=1;i<=ROWS;i++)insert.run(i,'valore-'+i)
 db.exec('COMMIT;PRAGMA wal_checkpoint(TRUNCATE);');db.close()
 const bytes=await readFile(file);log({phase:'file',rows:ROWS,bytes:bytes.length})
 // With PROBE_KEEP the database stays alive: the usage counter of deleted
 // databases may never be reported. The hourly usage workflow shows it later.
 name=KEEP?'upload-probe':'upload-probe-'+Date.now().toString(36)
 if(KEEP&&(await platform.databases()).some(d=>d.Name===name)){log({phase:'already-present',database:name});process.exitCode=0;name=null}
 if(name){
 const database=await platform.createUploadDatabase(name,group);created=true
 const jwt=await platform.databaseToken(name)
 await uploadDatabaseFile({hostname:database.Hostname,jwt,body:bytes,size:bytes.length})
 log({phase:'uploaded',database:name})
 const {createClient}=await import('@libsql/client/web')
 const client=createClient({url:'libsql://'+database.Hostname,authToken:jwt})
 let maximum
 for(let attempt=0;attempt<12;attempt++){
  try{maximum=Number((await client.execute('SELECT max(id) n FROM probe')).rows[0].n);break}catch(error){log({phase:'waiting-database',attempt,error:safeTursoError(error).slice(0,120)});await sleep(10000)}
 }
 if(maximum!==ROWS)throw Error('Il file caricato non contiene le righe attese.')
 await client.batch(['CREATE TABLE control(id INTEGER PRIMARY KEY)',{sql:"WITH RECURSIVE n(i) AS(SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?) INSERT INTO control SELECT i FROM n",args:[CONTROL]}],'write')
 client.close()
 log({phase:'verified',rows:maximum,control_rows:CONTROL})
 let after=before
 for(let i=0;i<(KEEP?2:12);i++){
  await sleep(30000)
  after=await platform.usage()
  const written=after.rows_written-before.rows_written
  log({phase:'usage-after',minutes:(i+1)/2,rows_written_delta:written,rows_read_delta:after.rows_read-before.rows_read,storage_bytes:after.storage_bytes})
  if(written>=CONTROL&&i>=5)break
 }
 const written=after.rows_written-before.rows_written
 const verdict=written<CONTROL?'Contatore non aggiornato nella finestra: ripetere la prova più tardi.':written<CONTROL+ROWS/2?'Il caricamento del file NON conta come righe scritte.':'Il caricamento del file CONTA come righe scritte.'
 log({phase:'result',rows_written_delta:written,expected_if_counted:ROWS*2+CONTROL,verdict})
 }
}catch(error){console.error(safeTursoError(error));exit=1}
finally{
 if(created&&!KEEP)try{await platform.deleteDatabase(name);log({phase:'deleted',database:name})}catch(error){console.error('Eliminazione del database di prova non riuscita: '+safeTursoError(error));exit=1}
 await rm(file,{force:true}).catch(()=>{})
 process.exitCode=exit
}

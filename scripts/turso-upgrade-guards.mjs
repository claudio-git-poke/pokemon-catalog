import schemaSource from '../data/turso-source-schema.json' with {type:'json'}
import {connectCatalogDatabase} from './turso-worker-runtime.mjs'
import {installManualGuards,GUARD_VERSION} from '../src/server/turso-manual.mjs'
import {safeTursoError} from './turso-client.mjs'
// Installs a new version of the manual-edit guards on the live database.
// The API is marked not ready while triggers are replaced, so no manual edit
// can pass unguarded; it is marked ready again only after the new version is
// recorded. Run in the worker's concurrency group, never during a publication.
const log=value=>console.log(JSON.stringify(value))
let client,exit=0
try{
 ({client}=await connectCatalogDatabase(process.env,{expiration:'1h'}))
 const before=Number((await client.execute('SELECT version FROM _catalog_guard_version WHERE id=1')).rows[0]?.version||0)
 if(before>=GUARD_VERSION)log({phase:'guards',version:before,changed:false})
 else{
  await client.execute('UPDATE _catalog_api_state SET ready=0 WHERE id=1')
  const started=Date.now()
  // The stored tables only: the public schema also lists derived views,
  // which cannot carry triggers (same schema as the original preparation).
  await installManualGuards(client,schemaSource)
  const after=Number((await client.execute('SELECT version FROM _catalog_guard_version WHERE id=1')).rows[0]?.version||0)
  if(after!==GUARD_VERSION)throw Error('Versione delle protezioni non registrata: il catalogo resta non pronto.')
  await client.execute('UPDATE _catalog_api_state SET ready=1 WHERE id=1')
  log({phase:'guards',from:before,version:after,changed:true,seconds:Math.round((Date.now()-started)/1000)})
 }
}catch(error){console.error(safeTursoError(error));exit=1}
finally{client?.close();process.exitCode=exit}

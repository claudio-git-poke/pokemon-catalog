import {connectCatalogDatabase} from './turso-worker-runtime.mjs'
import {createPlatform,platformConfiguration} from './turso-platform.mjs'
import {FREE_LIMITS} from './turso-budget.mjs'
import {ensureReadIndexes} from '../src/server/turso-schema.mjs'
import {safeTursoError} from './turso-client.mjs'
// One-off creation of the read indexes on the live database. Building an
// index writes one entry per printing (about 350,000 each), so the run
// requires at least one million rows of margin below the 80% stop.
const log=value=>console.log(JSON.stringify(value))
let client,exit=0
try{
 const usage=await createPlatform(platformConfiguration()).usage()
 const margin=Math.floor(FREE_LIMITS.rows_written*0.8)-usage.rows_written
 log({phase:'usage',...usage,margin})
 if(margin<1_000_000)throw Error('Margine di scrittura insufficiente per creare gli indici: rimando al prossimo mese.')
 ;({client}=await connectCatalogDatabase(process.env,{expiration:'1h'}))
 const created=await ensureReadIndexes(client,{log})
 log({phase:'done',created})
}catch(error){console.error(safeTursoError(error));exit=1}
finally{client?.close();process.exitCode=exit}

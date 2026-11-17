import {readFile} from 'node:fs/promises'
import {createTursoClient,safeTursoError} from './turso-client.mjs'
import {prepareCatalogSchema} from '../src/server/turso-schema.mjs'
let client
try{client=(await createTursoClient()).client;const schema=JSON.parse(await readFile(new URL('../data/turso-source-schema.json',import.meta.url),'utf8'));console.log(JSON.stringify(await prepareCatalogSchema(client,schema,{log:value=>console.log(JSON.stringify(value))})))}
catch(error){console.error(safeTursoError(error));process.exitCode=1}
finally{client?.close()}

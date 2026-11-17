import assert from 'node:assert/strict'
import {createTursoClient,safeTursoError} from './turso-client.mjs'
let client
try{
 const connected=await createTursoClient();client=connected.client
 const result=await client.execute(`SELECT 1 AS connected, json_valid('{"ok":true}') AS json_support`)
 assert.equal(Number(result.rows[0]?.connected),1)
 assert.equal(Number(result.rows[0]?.json_support),1)
 console.log(JSON.stringify({check:'turso-connection',status:'ok',engine:connected.engine,json_support:true,read_only_probe:true}))
}catch(error){console.error(safeTursoError(error));process.exitCode=1}
finally{client?.close()}

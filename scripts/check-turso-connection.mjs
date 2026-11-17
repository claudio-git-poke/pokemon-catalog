import assert from 'node:assert/strict'
import {createTursoClient,safeTursoError} from './turso-client.mjs'
let client
try{
 const connected=await createTursoClient();client=connected.client
 const result=await client.execute(`SELECT 1 AS connected, json_valid('{"ok":true}') AS json_support`)
 assert.equal(Number(result.rows[0]?.connected),1)
 assert.equal(Number(result.rows[0]?.json_support),1)
 console.log(JSON.stringify({check:'turso-connection',status:'ok',engine:connected.engine,json_support:true,read_only_probe:true}))
 const copying=(await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='_catalog_snapshot_state'")).rows.length
 if(copying){
  const rows=(await client.execute('SELECT table_name,n,manual_n,state FROM _catalog_snapshot_state ORDER BY table_name')).rows.map(r=>({table:r.table_name,rows:Number(r.n),manual:Number(r.manual_n),state:r.state}))
  console.log(JSON.stringify({check:'turso-copy-progress',rows:rows.reduce((n,r)=>n+r.rows,0),verified:rows.filter(r=>r.state==='verified').length,tables:rows}))
 }
 const preparing=(await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='_catalog_api_build'")).rows.length
 if(preparing){
  const tasks=(await client.execute('SELECT task,cursor,complete FROM _catalog_api_build ORDER BY task')).rows.map(r=>({task:r.task,rows:Number(r.cursor),complete:!!Number(r.complete)}))
  const state=(await client.execute('SELECT ready FROM _catalog_api_state WHERE id=1')).rows[0]
  console.log(JSON.stringify({check:'turso-api-progress',ready:!!Number(state?.ready),tasks}))
 }
 const pages=Number(Object.values((await client.execute('PRAGMA page_count')).rows[0])[0]),pageSize=Number(Object.values((await client.execute('PRAGMA page_size')).rows[0])[0])
 console.log(JSON.stringify({check:'turso-storage',bytes:pages*pageSize}))
}catch(error){console.error(safeTursoError(error));process.exitCode=1}
finally{client?.close()}

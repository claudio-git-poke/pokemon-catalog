import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createClient} from '@supabase/supabase-js'
import {createTursoClient,safeTursoError} from './turso-client.mjs'
import {workerSchemaStatements} from './turso-worker-schema.mjs'
import {hydrateWorker} from './turso-worker-data.mjs'
import {createPsqlSession,startWorkerRest} from './turso-worker-runtime.mjs'
import {readCatalogRows} from '../src/server/turso-rest.mjs'
import {readCatalogRpc} from '../src/server/turso-rpcs.mjs'
import {canonicalJson} from './turso-snapshot.mjs'
let client,pg,rest
try{
 client=(await createTursoClient()).client
 const available=(await client.execute("SELECT name FROM sqlite_master WHERE name='_catalog_api_state'")).rows.length
 const ready=available?Number((await client.execute('SELECT ready FROM _catalog_api_state WHERE id=1')).rows[0]?.ready):0
 if(!ready)console.log(JSON.stringify({check:'native-worker',verified:false,reason:'snapshot-or-indexes-incomplete',publication:false}))
 else{
  const snapshot=JSON.parse(await readFile(new URL('../data/turso-worker-pg-schema.json',import.meta.url),'utf8')),schema=JSON.parse(await readFile(new URL('../data/turso-source-schema.json',import.meta.url),'utf8'))
  pg=createPsqlSession()
  for(const statement of workerSchemaStatements(snapshot))await pg.executeSql(statement)
  console.log(JSON.stringify({phase:'native-schema',tables:snapshot.tables.length,functions:snapshot.functions.length}))
  await hydrateWorker({client,snapshot,executeSql:pg.executeSql,log:value=>console.log(JSON.stringify(value))})
  rest=await startWorkerRest({mask:value=>console.log('::add-mask::'+value)})
  const db=createClient(rest.url,rest.token,{auth:{persistSession:false,autoRefreshToken:false}})
  for(const table of snapshot.tables.filter(t=>t.name!=='catalog_sync_events')){
   const expected=Number((await client.execute('SELECT count(*) n FROM "_copy_'+table.name+'"')).rows[0].n)
   const {count,error}=await db.from(table.name).select('*',{head:true,count:'exact'})
   if(error)throw Error('Verifica nativa '+table.name+': '+error.code)
   assert.equal(count,expected,'Conteggio nativo diverso: '+table.name)
  }
  for(const [name,params]of [
   ['cards',{select:'id,nome,sigla,lingua,image_url,manual_overrides',order:'id',limit:'5'}],
   ['catalog_search_entries',{select:'entry_key,card_id,name,tags,facts,cards(image_url,link_cardmarket)',name:'ilike.%Iono%',order:'entry_key',limit:'5'}]
  ]){
   const query=new URLSearchParams(params),native=await fetch(rest.url+'/rest/v1/'+name+'?'+query,{headers:{apikey:rest.token,Authorization:'Bearer '+rest.token}})
   if(!native.ok)throw Error('Lettura nativa: HTTP '+native.status)
   const actual=await native.json(),expected=(await readCatalogRows(client,schema,name,query)).rows
   assert.ok(canonicalJson(actual)===canonicalJson(expected),'Lettura nativa diversa: '+name)
  }
  const params={symbol_group:'38c3e9d561c7b766d3ece9a05e50d763',page_size:5,include_review:false}
  const native=await db.rpc('catalog_visual_group_cards',params),expected=await readCatalogRpc(client,'catalog_visual_group_cards',params)
  if(native.error)throw Error('Simboli nativi: '+native.error.code)
  assert.deepEqual(native.data.results.map(r=>r.entry_key),expected.results.map(r=>r.entry_key))
  console.log(JSON.stringify({check:'native-worker',verified:true,tables:30,functions:71,publication:false,source_unchanged:true}))
 }
}catch(error){console.error(safeTursoError(error));process.exitCode=1}
finally{if(rest)await rest.close();if(pg)await pg.close();client?.close()}

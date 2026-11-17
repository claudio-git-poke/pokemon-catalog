import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createTursoClient,safeTursoError} from './turso-client.mjs'
import {canonicalJson} from './turso-snapshot.mjs'
import {readCatalogRows} from '../src/server/turso-rest.mjs'
import {readCatalogRpc} from '../src/server/turso-rpcs.mjs'
let client
try{
 client=(await createTursoClient()).client
 const schema=JSON.parse(await readFile(new URL('../data/turso-source-schema.json',import.meta.url),'utf8'))
 const exists=(await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='_catalog_api_state'")).rows.length
 const state=exists?(await client.execute('SELECT ready FROM _catalog_api_state WHERE id=1')).rows[0]:null
 if(!Number(state?.ready)){console.log(JSON.stringify({check:'turso-api-parity',verified:false,reason:'snapshot-or-indexes-incomplete'}))}
 else{
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
  if(!url||!key)throw Error('Servono le credenziali dell’origine per il confronto di sola lettura.')
  async function source(path,body){
   const result=await fetch(new URL('/rest/v1/'+path,url),{method:body?'POST':'GET',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)})
   if(!result.ok)throw Error('Confronto origine: HTTP '+result.status)
   return result.json()
  }
  for(const [name,params]of [
   ['cards',{select:'id,nome,sigla,lingua,numero,image_url,image_status,manual_overrides',order:'id',limit:'8'}],
   ['catalog_search_entries',{select:'entry_key,card_id,name,set_code,language,tags,image_url,cards(image_url,link_cardmarket)',or:'(set_code.eq."SV02",set_code.like."SV02@*")',order:'cards(image_url).asc.nullslast,card_id.asc,entry_key.asc',limit:'25'}],
   ['catalog_search_entries',{select:'entry_key,card_id,name,source_payload',search_vector:'fts(simple).iono&269',order:'entry_key',limit:'25'}]
  ]){
   const query=new URLSearchParams(params),original=await source(name+'?'+query),copied=await readCatalogRows(client,schema,name,query)
   assert.ok(canonicalJson(copied.rows)===canonicalJson(original),'Lettura diversa: '+name)
   console.log(JSON.stringify({check:'turso-api-parity',table:name,rows:copied.rows.length,verified:true}))
  }
  for(const [name,params]of [
   ['catalog_visual_group_cards',{symbol_group:'38c3e9d561c7b766d3ece9a05e50d763',page_size:100,include_review:false}],
   ['identify_catalog_cards',{tokens:['iono'],required_tags:[],card_number:'269',wanted_language:'IT',page_size:24}]
  ]){
   const original=await source('rpc/'+name,params),copied=await readCatalogRpc(client,name,params)
   const identity=r=>({entry_key:r.entry_key,language:r.language,actual_language:r.actual_language??null,tags:r.tags})
   assert.ok(canonicalJson(copied.results.map(identity))===canonicalJson(original.results.map(identity)),'Risultati diversi: '+name)
   if(original.total!==undefined)assert.equal(copied.total,original.total)
   if(original.has_more!==undefined)assert.equal(copied.has_more,original.has_more)
   console.log(JSON.stringify({check:'turso-api-parity',rpc:name,rows:copied.results.length,verified:true}))
  }
  console.log(JSON.stringify({check:'turso-api-parity',verified:true,cutover:false,source_unchanged:true}))
 }
}catch(error){console.error(safeTursoError(error));process.exitCode=1}
finally{client?.close()}

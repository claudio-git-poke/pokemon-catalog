import schemaSource from '../data/turso-source-schema.json' with {type:'json'}
import {connectCatalogDatabase} from './turso-worker-runtime.mjs'
import {publicCatalogSchema} from '../src/server/turso-schema.mjs'
import {readCatalogRows} from '../src/server/turso-rest.mjs'
import {safeTursoError} from './turso-client.mjs'
// Runs the searches ricercaDB sends, through the same adapter the site uses,
// on the real Turso database with a read-only token. Reports time, rows,
// query plan (full scans) and the rows read reported by the server.
const log=value=>console.log(JSON.stringify(value))
const schema=publicCatalogSchema(schemaSource)
const SELECT='entry_key,card_id,name,set_code,language,collector_number,denominator,label,tags,image_url,verification,cardmarket_url,source_url,set_name:source_payload->set->>name,rarity:source_payload->>rarity,tcgp:source_payload->variant->thirdParty->>tcgplayer,cards(image_url,link_cardmarket)'
const ORDER='cards(image_url).asc.nullslast,card_id.asc'
const setFilter=code=>`(set_code.eq."${code}",set_code.like."${code}@*")`
const searches={
 nome:{search_vector:'fts(simple).pikachu:*',order:ORDER},
 nome_due_parole:{search_vector:'fts(simple).charizard:*&ex:*',order:ORDER},
 nome_e_lingua:{search_vector:'fts(simple).pikachu:*',language:'eq.IT',order:ORDER},
 solo_espansione:{or:setFilter('SV02')},
 espansione_e_numero:{or:setFilter('SV02'),collector_number:'eq.269',order:ORDER},
 solo_numero:{collector_number:'eq.4',order:ORDER},
 solo_totale:{denominator:'in.(102,102,102)',order:ORDER},
 lingua_e_finitura:{language:'eq.JP',and:'(tags.ov.{"finish:reverse-holo"})',order:ORDER},
 timbro_e_nome:{search_vector:'fts(simple).pikachu:*',and:'(tags.ov.{"stamp:prerelease"})',order:ORDER}
}
// Sum the rows_read / rows_written counters found anywhere in Hrana responses.
let counted={rows_read:0,rows_written:0,seen:false}
function walk(value){
 if(Array.isArray(value)){for(const item of value)walk(item);return}
 if(!value||typeof value!=='object')return
 for(const [key,item]of Object.entries(value)){if((key==='rows_read'||key==='rows_written')&&typeof item==='number'){counted[key]+=item;counted.seen=true}else walk(item)}
}
async function countingFetch(input,init){
 const response=await fetch(input,init)
 response.clone().text().then(text=>{for(const line of text.split('\n')){if(!line.trim())continue;try{walk(JSON.parse(line))}catch{}}}).catch(()=>{})
 return response
}
let client,exit=0
try{
 ({client}=await connectCatalogDatabase(process.env,{expiration:'1h',authorization:'read-only',clientFetch:countingFetch}))
 const captured=[]
 const recording={execute:async input=>{captured.push(input);return client.execute(input)}}
 for(const [name,filters]of Object.entries(searches)){
  captured.length=0;counted={rows_read:0,rows_written:0,seen:false}
  const params=new URLSearchParams({select:SELECT,...filters,limit:'200'})
  const started=Date.now()
  let rows=null,error=null
  try{rows=(await readCatalogRows(recording,schema,'catalog_search_entries',params)).rows.length}catch(cause){error=safeTursoError(cause).slice(0,160)}
  const ms=Date.now()-started
  await new Promise(r=>setTimeout(r,300))
  const reads={...counted}
  const plan=[]
  for(const input of captured){try{plan.push(...(await client.execute({sql:'EXPLAIN QUERY PLAN '+input.sql,args:input.args})).rows.map(r=>r.detail))}catch(cause){plan.push('piano non disponibile: '+safeTursoError(cause).slice(0,80))}}
  log({search:name,ms,rows,error,rows_read:reads.seen?reads.rows_read:'non riportato',full_scans:plan.filter(d=>/^SCAN /.test(d)&&!/USING (COVERING )?INDEX|VIRTUAL TABLE/.test(d)),temp_sort:plan.some(d=>/TEMP B-TREE/.test(d)),plan})
 }
 const assets=new URLSearchParams({select:'kind,source_code,image_url,tag_code,tag_codes,provenance',availability:'eq.available',scope:'in.(physical,reference)',kind:'in.(promo_stamp,rarity,energy,retailer_reference)',limit:'500'})
 const started=Date.now()
 log({search:'simboli',ms:0,rows:(await readCatalogRows(client,schema,'catalog_visual_assets',assets)).rows.length,elapsed:Date.now()-started})
}catch(error){console.error(safeTursoError(error));exit=1}
finally{client?.close();process.exitCode=exit}

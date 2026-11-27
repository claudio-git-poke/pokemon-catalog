// Compares manual edits between the old and the new Turso database, read-only:
// counts, latest edit, and edits in the old database missing from the new one.
import {platformConfiguration,createPlatform} from './turso-platform.mjs'
const platform=createPlatform(platformConfiguration())
const [oldName,newName]=[process.env.OLD_DATABASE||'pokemon-catalog',process.env.NEW_DATABASE||'pokemon-catalog-2']
const all=await platform.databases()
async function client(name){
 const db=all.find(d=>d.Name===name);if(!db)throw Error('Database non trovato: '+name)
 const jwt=await platform.databaseToken(name,{expiration:'1h',authorization:'read-only'})
 return async sql=>{
  const r=await fetch('https://'+db.Hostname+'/v2/pipeline',{method:'POST',headers:{authorization:'Bearer '+jwt,'content-type':'application/json'},body:JSON.stringify({requests:[{type:'execute',stmt:{sql}},{type:'close'}]})})
  const j=await r.json();const res=j.results?.[0];if(res?.type!=='ok')throw Error(name+': '+JSON.stringify(res?.error||j).slice(0,300))
  const {cols,rows}=res.response.result;return rows.map(row=>Object.fromEntries(row.map((v,i)=>[cols[i].name,v?.value??null])))
 }
}
const newDb=await client(newName),oldDb=all.some(d=>d.Name===oldName)?await client(oldName):null
const summary="SELECT count(*) n,max(json_extract(_row,'$.at')) ultima,max(CAST(json_extract(_row,'$.id') AS INTEGER)) max_id FROM _copy_catalog_manual_history"
const n=(await newDb(summary))[0],o=oldDb?(await oldDb(summary))[0]:null
console.log(JSON.stringify({vecchio:o||'non più presente',nuovo:n}))
const after=!oldDb?[]:await oldDb(`SELECT json_extract(_row,'$.id') id,json_extract(_row,'$.at') at,json_extract(_row,'$.table_name') t,json_extract(_row,'$.record_key') k FROM _copy_catalog_manual_history WHERE CAST(json_extract(_row,'$.id') AS INTEGER)>${Number(n.max_id)||0} ORDER BY 1`)
console.log(JSON.stringify({modifiche_mancanti:after.length,per_tabella:after.reduce((a,r)=>(a[r.t]=(a[r.t]||0)+1,a),{}),prima:after[0]?.at||null,ultima:after.at(-1)?.at||null}))
for(const r of after.slice(0,50))console.log(JSON.stringify(r))
// Who wrote the history of the new database, by role, table and day.
const groupBy=expr=>`SELECT ${expr} k,count(*) n FROM _copy_catalog_manual_history GROUP BY 1 ORDER BY 2 DESC LIMIT 15`
for(const [label,expr] of [['ruolo',"json_extract(_row,'$.actor_role')"],['tabella',"json_extract(_row,'$.table_name')"],['giorno',"substr(json_extract(_row,'$.at'),1,10)"],['motivo',"substr(json_extract(_row,'$.reason'),1,60)"],['campi',"substr(json_extract(_row,'$.changed_fields'),1,60)"]])console.log(JSON.stringify({[label]:await newDb(groupBy(expr))}))
console.log(JSON.stringify({dimensione_media:await newDb("SELECT avg(length(_row)) byte,sum(length(_row)) totale FROM _copy_catalog_manual_history")}))

// One-time, local bootstrap preparation. Reads public reference snapshots only.
// Usage: node --experimental-strip-types scripts/prepare-bindex-reference.mjs sets.json cards.json output-directory
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {referenceTags,stableKey} from './bindex-identity.mjs'
const [setsPath,cardsPath,directory]=process.argv.slice(2)
if(!directory)throw Error('Servono i percorsi sets.json, cards.json e della directory SQL di output.')
await mkdir(directory,{recursive:true})
const sets=JSON.parse(await readFile(setsPath,'utf8')),cards=JSON.parse(await readFile(cardsPath,'utf8')),bySet=new Map(sets.map(s=>[s.sigla,s])),seen=new Set()
const sqlJSON=x=>"'"+JSON.stringify(x).replaceAll("'","''")+"'::jsonb"
const setRows=sets.map(({aggiornato_il,...s})=>s)
await writeFile(directory+'/sets.sql',`insert into public.set_espansioni(sigla,tcgdex_id,nome,carte_base,carte_totali,data_uscita,lingua) select sigla,tcgdex_id,nome,carte_base,carte_totali,data_uscita,lingua from jsonb_populate_recordset(null::public.set_espansioni,${sqlJSON(setRows)}) on conflict(sigla) do nothing;`)
const output=[]
for(const r of cards){
 if(seen.has(stableKey(r)))throw Error('Chiave duplicata nel riferimento: '+stableKey(r));seen.add(stableKey(r))
 if(!bySet.has(r.sigla)||!Number.isInteger(r.numero)||r.numero<1||! /^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.variante))throw Error('Identità non valida: '+stableKey(r))
 let codice=r.codice
 if(!codice&&bySet.get(r.sigla).tcgdex_id&&bySet.get(r.sigla).lingua==='INT')codice=r.sigla+' '+String(r.numero).padStart(3,'0')
 if(codice&&!/^[A-Z0-9][A-Z0-9.-]*( [A-Z0-9]+)?$/.test(codice))throw Error('Codice non valido: '+codice)
 const url=r.cardmarket_url?new URL(r.cardmarket_url):null
 if(url){url.search='';url.hash='';if(url.origin!=='https://www.cardmarket.com'||!url.pathname.startsWith('/it/Pokemon/Products/'))throw Error('Pagina non valida')}
 output.push({...r,codice,cardmarket_url:url?.href||null,tag:referenceTags(r),immagine_hd:null,immagine_verificata:false,eliminata:false})
}
const columns=['sigla','numero','variante','nome','rarita','codice','cardmarket_id','cardmarket_url','immagine','immagine_hd','tag','immagine_verificata','eliminata']
let batch=[],bytes=0,index=0
async function flush(){if(!batch.length)return;const query=`insert into public.set_carte(${columns}) select ${columns} from jsonb_populate_recordset(null::public.set_carte,${sqlJSON(batch)}) on conflict(sigla,numero,variante) do nothing;`;await writeFile(directory+`/cards-${String(index++).padStart(3,'0')}.sql`,query);batch=[];bytes=0}
for(const r of output){const size=JSON.stringify(r).length;if(bytes+size>280000)await flush();batch.push(r);bytes+=size}
await flush()
const sorted=[...output].sort((a,b)=>a.sigla<b.sigla?-1:a.sigla>b.sigla?1:a.numero-b.numero||(a.variante<b.variante?-1:a.variante>b.variante?1:0))
const digest=createHash('md5').update(sorted.map(r=>`${r.sigla}|${r.numero}|${r.variante}`).join('\n')).digest('hex')
await writeFile(directory+'/expected.json',JSON.stringify({sets:sets.length,cards:cards.length,key_digest:digest,pages:index,codes_missing:output.filter(r=>!r.codice).length,reference:'https://bindexxx.github.io/bindex/',prepared_at:new Date().toISOString()},null,2))
console.log({sets:sets.length,cards:cards.length,key_digest:digest,pages:index,codes_missing:output.filter(r=>!r.codice).length})

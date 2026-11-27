// Builds data/set-completeness.json: for every catalogue set, cards present,
// cards expected (set sheets), missing numbers, cards with photo and cards
// with metadata (rarity, type, stage...). Reads a local SQLite file
// (CATALOG_FILE) or Turso with a read-only token; weekly, about 2M reads.
import {readFile,writeFile} from 'node:fs/promises'
import {sheetLookup} from '../src/lib/set-sheet-lookup.mjs'
import {cardNumber,FAMILIES,printingKeys} from './twin-traits.mjs'

export function completeness({cards,traitCards,sheets}){
 const find=sheetLookup(sheets),by=new Map(),keyOf=printingKeys(sheets),printed=new Set()
 for(const c of cards){if(!by.has(c.sigla))by.set(c.sigla,[]);by.get(c.sigla).push(c);const k=keyOf(c);if(k)printed.add(`${k}|${c.lingua}|${c.sigla}`)}
 // A number missing from one code may sit under another code of the same set
 // in the same language (DP@FR and DP1@FR): it is present, not missing.
 const elsewhere=(sigla,lingua,n)=>{const k=keyOf({sigla,numero:n});if(!k)return false;for(const s of by.keys())if(s!==sigla&&printed.has(`${k}|${lingua}|${s}`))return true;return false}
 const rows=[]
 for(const [sigla,list] of by){
  const sheet=find(sigla),expected=sheet&&!sheet.derived_from?(sheet.total||sheet.official||null):null
  const numbers=new Set(list.map(cardNumber).filter(Boolean))
  let missing=null,missingNumbers=[],other=0
  if(expected){
   missing=Math.max(0,expected-Math.min(numbers.size,expected))
   // Numbers 1..official that no card carries (plain numbering only).
   const official=sheet.official||expected,lingua=list[0].lingua
   if(missing)for(let n=1;n<=official;n++){if(numbers.has(String(n)))continue;if(elsewhere(sigla,lingua,n))other++;else if(missingNumbers.length<60)missingNumbers.push(n)}
   missing=Math.max(0,missing-other)
  }
  rows.push({sigla,lingua:list[0].lingua,cards:list.length,expected,missing,elsewhere:other||undefined,missing_numbers:missing&&missingNumbers.length?missingNumbers:undefined,with_photo:list.filter(c=>c.photo).length,with_traits:list.filter(c=>traitCards.has(c.id)).length})
 }
 return rows.sort((a,b)=>a.sigla.localeCompare(b.sigla))
}
const CARDS_SQL=`SELECT json_extract(_row,'$.id') id,json_extract(_row,'$.sigla') sigla,json_extract(_row,'$.lingua') lingua,json_extract(_row,'$.numero') numero,json_extract(_row,'$.source_local_id') source_local_id,json_extract(_row,'$.image_status') IN ('found','manual') AND coalesce(json_extract(_row,'$.image_url'),'')<>'' photo FROM _copy_cards`
const TRAITS_SQL=`SELECT DISTINCT json_extract(e._row,'$.card_id') id FROM _catalog_entry_tags t JOIN _copy_catalog_search_entries e ON e.rowid=t.entry_rowid WHERE ${FAMILIES.map(()=>'(t.tag>=? AND t.tag<?)').join(' OR ')}`
const TRAITS_ARGS=FAMILIES.flatMap(f=>[f+':',f+';'])
export async function readCatalog(query){
 return {cards:await query(CARDS_SQL,[]),traitCards:new Set((await query(TRAITS_SQL,TRAITS_ARGS)).map(r=>r.id))}
}
if(import.meta.url===`file://${process.argv[1]}`){
 let query,close=()=>{}
 if(process.env.CATALOG_FILE){const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(process.env.CATALOG_FILE,{readOnly:true});query=async(sql,args)=>db.prepare(sql).all(...args);close=()=>db.close()}
 else{const {connectCatalogDatabase}=await import('./turso-worker-runtime.mjs');const {client}=await connectCatalogDatabase(process.env,{expiration:'1h',authorization:'read-only'});query=async(sql,args)=>(await client.execute({sql,args})).rows;close=()=>client.close()}
 const {sets}=JSON.parse(await readFile(new URL('../data/set-sheets.json',import.meta.url),'utf8'))
 const rows=completeness({...await readCatalog(query),sheets:sets});close()
 const out=process.env.SET_COMPLETENESS_FILE||new URL('../data/set-completeness.json',import.meta.url).pathname
 await writeFile(out,JSON.stringify({schema:'set-completeness-v1',generated_at:new Date().toISOString(),sets:rows})+'\n')
 const sum=k=>rows.reduce((a,r)=>a+(r[k]||0),0)
 console.log(JSON.stringify({sets:rows.length,cards:sum('cards'),expected:sum('expected'),missing:sum('missing'),with_photo:sum('with_photo'),with_traits:sum('with_traits')}))
}

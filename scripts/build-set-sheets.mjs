// Builds data/set-sheets.json: one sheet per catalog set code (the cards'
// `sigla`, e.g. SV08@INT, SV8A@JP, 30C@EN) with name, series, release date
// and card totals. Sources, in order of preference: TCGdex set details (every
// catalog language), the Card Atlas archive (official Japanese, Korean and
// Taiwanese sets), Limitless set lists (English and Japanese). A language
// without its own sheet borrows the sheet of the same code in the original
// language (Japanese for Asian editions, English for the others), marked as
// `derived_from`. The file is static data for the site: no database writes.
import {readdir,readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {CATALOG_LANGUAGES} from '../src/lib/catalog-languages.ts'
import {sheetLookup} from '../src/lib/set-sheet-lookup.mjs'
export {looseKey,sheetLookup} from '../src/lib/set-sheet-lookup.mjs'

const UA={'User-Agent':'BindexCatalog/1.0 (+https://github.com/claudio-git-poke/pokemon-catalog)'}
const key=(code,lang)=>`${String(code).trim().toUpperCase()}@${lang}`
async function getJson(url,{tries=3}={}){
 for(let i=1;;i++){
  try{const r=await fetch(url,{headers:UA,signal:AbortSignal.timeout(30000)});if(r.status===404)return null;if(!r.ok)throw Error(`${url} HTTP ${r.status}`);return await r.json()}
  catch(error){if(i>=tries)throw error;await new Promise(r=>setTimeout(r,1000*i))}
 }
}
async function pool(items,size,fn){const out=[];let next=0;await Promise.all(Array.from({length:size},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i])}}));return out}
const clean=s=>String(s||'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#039;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim()
const MONTHS={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12}
export function limitlessDate(text){
 const m=String(text||'').trim().match(/^(\d{1,2}) ([A-Z][a-z]{2}) (\d{2})$/);if(!m||!MONTHS[m[2]])return null
 const year=Number(m[3])+(Number(m[3])>90?1900:2000)
 return `${year}-${String(MONTHS[m[2]]).padStart(2,'0')}-${m[1].padStart(2,'0')}`
}
// Rows of https://limitlesstcg.com/cards and /cards/jp.
export function limitlessSetRows(html,region){
 const rows=[]
 for(const tr of String(html).split(/<tr[\s>]/).slice(1)){
  const link=tr.match(/<a href="\/cards\/(?:jp\/)?([A-Za-z0-9.-]+)"><img[^>]*>\s*([^<]+?)\s*<span class="code annotation">([^<]+)<\/span>/)
  if(!link)continue
  const cells=[...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m=>m[1])
  const date=limitlessDate(clean(cells[1]));const total=Number(clean(cells[2]).match(/^\d+/)?.[0])
  const market=tr.match(/https:\/\/www\.cardmarket\.com\/en\/Pokemon\/Expansions\/([^?"]+)/)?.[1]||null
  rows.push({code:link[3].trim(),name:clean(link[2]),release_date:date,total:total>0?total:null,cardmarket_expansion:market,source_url:`https://limitlesstcg.com/cards/${region==='jp'?'jp/':''}${link[1]}`})
 }
 return rows
}
export async function atlasSheets(root,log=()=>{}){
 const sheets={}
 for(const [folder,lang] of [['jp','JP'],['ko','KOR'],['tc','CHN-T']]){
  let dirs=[];try{dirs=(await readdir(path.join(root,`data_${folder}`),{withFileTypes:true})).filter(d=>d.isDirectory())}catch{log(`Atlas ${folder}: cartella assente`);continue}
  for(const d of dirs){
   const files=(await readdir(path.join(root,`data_${folder}`,d.name))).filter(f=>f.endsWith('.json')).sort()
   // The product of the first cards names the set only when they agree:
   // in promo folders each card comes from a different event.
   const names=[],links=[];let total=null
   for(const f of files.slice(0,5)){
    try{const c=JSON.parse(await readFile(path.join(root,`data_${folder}`,d.name,f),'utf8'));names.push(c.sources?.find(s=>s?.name)?.name||null);links.push(c.sources?.find(s=>s?.link)?.link||null);const t=Number.parseInt(c.set_total,10);if(t>0)total??=t}catch{}
   }
   const agreed=names.length>=2&&names[0]&&names.every(n=>n===names[0])
   sheets[key(d.name,lang)]={code:d.name,language:lang,name:agreed?names[0]:null,total,official:total,source:'atlas',source_url:agreed?links[0]:null}
  }
 }
 return sheets
}
export function deriveSheets(sheets,codes){
 const lookup=sheetLookup(sheets),out={...sheets}
 for(const sigla of codes){const k=String(sigla).toUpperCase();if(out[k])continue;const s=lookup(k);if(s)out[k]=s}
 return out
}
export function sameSet(a,b){
 const ta=a.total||a.official,tb=b.total||b.official
 if(!ta||!tb)return !a.name||!b.name
 return Math.abs(ta-tb)<=Math.max(3,Math.round(Math.max(ta,tb)*0.1))
}
export async function buildSetSheets({atlasRoot=null,codes=[],log=console.log}={}){
 const sheets={}
 const put=(k,sheet)=>{const old=sheets[k];if(!old){sheets[k]=sheet;return}
  // Fill only the gaps of a sheet from a less preferred source, and only when
  // both describe the same set: one code can name different sets in different
  // sources (MG: an old Japanese deck in Card Atlas, a 2026 set in Limitless).
  if(!sameSet(old,sheet))return
  let used=false
  for(const [f,v] of Object.entries(sheet))if(old[f]==null&&v!=null){old[f]=v;used=true}
  if(used&&sheet.source!==old.source)old.also_from=[...new Set([...(old.also_from||[]),sheet.source])]
 }
 for(const {api,code:lang} of CATALOG_LANGUAGES){
  const list=await getJson(`https://api.tcgdex.net/v2/${api}/sets`).catch(e=>{log(`TCGdex ${api}: ${e}`);return null})
  if(!Array.isArray(list)){log(`TCGdex ${api}: nessun elenco`);continue}
  const details=await pool(list,8,s=>getJson(`https://api.tcgdex.net/v2/${api}/sets/${encodeURIComponent(s.id)}`).catch(()=>null))
  let n=0
  for(const [i,s] of list.entries()){
   const d=details[i]||s;if(d.serie?.id==='tcgp')continue
   put(key(s.id,lang),{code:s.id,language:lang,name:d.name||s.name||null,series:d.serie?.name||null,release_date:d.releaseDate||null,official:d.cardCount?.official??s.cardCount?.official??null,total:d.cardCount?.total??s.cardCount?.total??null,abbreviation:d.abbreviation?.official||null,logo:d.logo||s.logo||null,source:'tcgdex',source_url:`https://api.tcgdex.net/v2/${api}/sets/${s.id}`});n++
  }
  log(`TCGdex ${api}: ${n} set.`)
 }
 if(atlasRoot){const a=await atlasSheets(atlasRoot,log);for(const [k,s] of Object.entries(a))put(k,s);log(`Atlas: ${Object.keys(a).length} set.`)}
 for(const region of ['en','jp']){
  const res=await fetch(region==='en'?'https://limitlesstcg.com/cards':'https://limitlesstcg.com/cards/jp',{headers:UA,signal:AbortSignal.timeout(30000)}).catch(e=>({ok:false,statusText:String(e)}))
  if(!res.ok){log(`Limitless ${region}: ${res.status||res.statusText}`);continue}
  const rows=limitlessSetRows(await res.text(),region)
  // English codes also name the European editions documented by Limitless.
  for(const r of rows)for(const lang of region==='en'?['EN','IT','FR','DE','ES','PT']:['JP'])put(key(r.code,lang),{...r,language:lang,official:null,source:'limitless'})
  log(`Limitless ${region}: ${rows.length} set.`)
 }
 const all=deriveSheets(sheets,codes)
 return Object.fromEntries(Object.entries(all).sort(([a],[b])=>a.localeCompare(b)))
}
if(import.meta.url===`file://${process.argv[1]}`){
 const codes=process.env.CATALOG_CODES_FILE?JSON.parse(await readFile(process.env.CATALOG_CODES_FILE,'utf8')):[]
 const sets=await buildSetSheets({atlasRoot:process.env.ATLAS_DATA_DIR||null,codes})
 const out=process.env.SET_SHEETS_FILE||new URL('../data/set-sheets.json',import.meta.url).pathname
 await writeFile(out,JSON.stringify({schema:'set-sheets-v1',generated_at:new Date().toISOString(),sets})+'\n')
 console.log(`Schede dei set: ${Object.keys(sets).length} → ${out}`)
}
